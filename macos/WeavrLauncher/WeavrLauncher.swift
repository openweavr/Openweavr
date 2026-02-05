import AppKit
import Foundation
import ServiceManagement

private final class StatusBarController: NSObject {
  private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  private let menu = NSMenu()
  private let baseURL = URL(string: "http://localhost:3847")!

  private var serverProcess: Process?
  private var statusTimer: Timer?
  private var isServerReachable = false
  private var isWeavrInstalled = false

  // Menu items
  private lazy var statusMenuItem = NSMenuItem(title: "Status: Checking...", action: nil, keyEquivalent: "")
  private lazy var openMenuItem = NSMenuItem(title: "Open Weavr", action: #selector(openWebApp), keyEquivalent: "o")
  private lazy var startMenuItem = NSMenuItem(title: "Start Server", action: #selector(startServer), keyEquivalent: "s")
  private lazy var stopMenuItem = NSMenuItem(title: "Stop Server", action: #selector(stopServer), keyEquivalent: "")
  private lazy var restartMenuItem = NSMenuItem(title: "Restart Server", action: #selector(restartServer), keyEquivalent: "r")
  private lazy var installMenuItem = NSMenuItem(title: "Install Weavr CLI...", action: #selector(installWeavr), keyEquivalent: "")
  private lazy var launchAtLoginItem = NSMenuItem(title: "Launch at Login", action: #selector(toggleLaunchAtLogin), keyEquivalent: "")
  private lazy var autoStartItem = NSMenuItem(title: "Auto-start Server", action: #selector(toggleAutoStart), keyEquivalent: "")
  private lazy var logsMenuItem = NSMenuItem(title: "View Logs", action: #selector(openLogs), keyEquivalent: "l")
  private lazy var settingsMenuItem = NSMenuItem(title: "Settings...", action: #selector(openSettings), keyEquivalent: ",")
  private lazy var quitMenuItem = NSMenuItem(title: "Quit Weavr Launcher", action: #selector(quitApp), keyEquivalent: "q")

  private let workflowsHeaderItem = NSMenuItem(title: "Workflows", action: nil, keyEquivalent: "")
  private var workflowItems: [NSMenuItem] = []

  private let dateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateStyle = .short
    formatter.timeStyle = .short
    return formatter
  }()

  // User defaults keys
  private let kAutoStartServer = "autoStartServer"
  private let kHasCompletedOnboarding = "hasCompletedOnboarding"

  override init() {
    super.init()
    checkWeavrInstallation()
    setupMenu()
    setupStatusItem()
    startPolling()

    // First launch check
    if !UserDefaults.standard.bool(forKey: kHasCompletedOnboarding) {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        self?.showOnboarding()
      }
    }

    // Auto-start server if enabled
    if UserDefaults.standard.bool(forKey: kAutoStartServer) && isWeavrInstalled {
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
        self?.startServer()
      }
    }
  }

  private func checkWeavrInstallation() {
    let paths = [
      "/usr/local/bin/weavr",
      "/opt/homebrew/bin/weavr",
      "\(FileManager.default.homeDirectoryForCurrentUser.path)/.local/bin/weavr"
    ]
    isWeavrInstalled = paths.contains { FileManager.default.fileExists(atPath: $0) }
  }

  private func setupMenu() {
    // Status section
    statusMenuItem.isEnabled = false
    menu.addItem(statusMenuItem)
    menu.addItem(NSMenuItem.separator())

    // Main actions
    openMenuItem.target = self
    menu.addItem(openMenuItem)
    menu.addItem(NSMenuItem.separator())

    // Server controls
    startMenuItem.target = self
    stopMenuItem.target = self
    restartMenuItem.target = self
    menu.addItem(startMenuItem)
    menu.addItem(stopMenuItem)
    menu.addItem(restartMenuItem)
    menu.addItem(NSMenuItem.separator())

    // Workflows section
    workflowsHeaderItem.isEnabled = false
    let font = NSFont.systemFont(ofSize: 11, weight: .semibold)
    workflowsHeaderItem.attributedTitle = NSAttributedString(
      string: "WORKFLOWS",
      attributes: [.font: font, .foregroundColor: NSColor.secondaryLabelColor]
    )
    menu.addItem(workflowsHeaderItem)
    menu.addItem(NSMenuItem.separator())

    // Settings section
    installMenuItem.target = self
    launchAtLoginItem.target = self
    autoStartItem.target = self
    logsMenuItem.target = self
    settingsMenuItem.target = self

    menu.addItem(autoStartItem)
    menu.addItem(launchAtLoginItem)
    menu.addItem(NSMenuItem.separator())
    menu.addItem(logsMenuItem)
    menu.addItem(installMenuItem)
    menu.addItem(NSMenuItem.separator())

    // Quit
    quitMenuItem.target = self
    menu.addItem(quitMenuItem)

    updateMenuState()
  }

  private func setupStatusItem() {
    updateStatusIcon()
    statusItem.menu = menu
  }

  private func updateStatusIcon() {
    guard let button = statusItem.button else { return }

    // Try to load the Weavr logo
    if let logoImage = loadWeavrLogo() {
      button.image = logoImage
      button.imagePosition = .imageLeft

      // Add status indicator as a small dot
      if isServerReachable {
        button.title = " ●"
        // Use attributed string for green color
        let attrs: [NSAttributedString.Key: Any] = [
          .foregroundColor: NSColor.systemGreen,
          .font: NSFont.systemFont(ofSize: 8)
        ]
        button.attributedTitle = NSAttributedString(string: " ●", attributes: attrs)
      } else {
        button.title = ""
        button.attributedTitle = NSAttributedString(string: "")
      }
    } else {
      // Fallback to SF Symbols
      let imageName = isServerReachable ? "bolt.fill" : "bolt.slash"
      let color = isServerReachable ? NSColor.systemGreen : NSColor.secondaryLabelColor

      if let image = NSImage(systemSymbolName: imageName, accessibilityDescription: "Weavr") {
        let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .medium)
        let configuredImage = image.withSymbolConfiguration(config)
        button.image = configuredImage
        button.contentTintColor = color
      } else {
        button.title = isServerReachable ? "●" : "○"
      }
    }
  }

  private func loadWeavrLogo() -> NSImage? {
    // Try bundle resource first
    if let url = Bundle.main.url(forResource: "weavr-icon", withExtension: "png"),
       let image = NSImage(contentsOf: url) {
      return resizedImage(image, size: NSSize(width: 18, height: 18))
    }
    return nil
  }

  private func resizedImage(_ image: NSImage, size: NSSize) -> NSImage {
    let newImage = NSImage(size: size)
    newImage.lockFocus()
    image.draw(in: NSRect(origin: .zero, size: size),
               from: NSRect(origin: .zero, size: image.size),
               operation: .sourceOver,
               fraction: 1.0)
    newImage.unlockFocus()
    return newImage
  }

  private func startPolling() {
    statusTimer?.invalidate()
    statusTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
      self?.refreshStatus()
    }
    refreshStatus()
  }

  private func refreshStatus() {
    checkWeavrInstallation()

    var request = URLRequest(url: baseURL.appendingPathComponent("health"))
    request.timeoutInterval = 2.0

    let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
      DispatchQueue.main.async {
        guard let self = self else { return }
        let wasReachable = self.isServerReachable
        let ok = (response as? HTTPURLResponse)?.statusCode == 200 && error == nil && data != nil
        self.isServerReachable = ok
        if wasReachable != ok {
          self.updateStatusIcon()
        }
        self.updateMenuState()
      }
    }
    task.resume()

    if isServerReachable {
      refreshWorkflows()
    } else {
      updateWorkflowMenu(items: [])
    }
  }

  private func refreshWorkflows() {
    var request = URLRequest(url: baseURL.appendingPathComponent("api/scheduler"))
    request.timeoutInterval = 2.0

    let task = URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
      DispatchQueue.main.async {
        guard let self = self else { return }
        if let data = data, error == nil, let items = self.parseWorkflows(data: data) {
          self.updateWorkflowMenu(items: items)
        } else {
          self.updateWorkflowMenu(items: [])
        }
      }
    }
    task.resume()
  }

  private func updateMenuState() {
    // Status text
    if !isWeavrInstalled {
      statusMenuItem.title = "⚠️ Weavr CLI not installed"
      installMenuItem.isHidden = false
    } else if isServerReachable {
      statusMenuItem.title = "✓ Server running"
      installMenuItem.isHidden = true
    } else {
      statusMenuItem.title = "Server stopped"
      installMenuItem.isHidden = true
    }

    // Server controls
    let canStop = serverProcess?.isRunning == true
    startMenuItem.isEnabled = isWeavrInstalled && !isServerReachable && !canStop
    stopMenuItem.isEnabled = canStop || isServerReachable
    restartMenuItem.isEnabled = isWeavrInstalled && (isServerReachable || canStop)
    openMenuItem.isEnabled = isServerReachable

    // Checkmarks
    autoStartItem.state = UserDefaults.standard.bool(forKey: kAutoStartServer) ? .on : .off
    launchAtLoginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
  }

  // MARK: - Actions

  @objc private func openWebApp() {
    NSWorkspace.shared.open(baseURL)
  }

  @objc private func startServer() {
    guard isWeavrInstalled, !isServerReachable else { return }

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["weavr", "serve"]

    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = buildPathEnv()
    process.environment = environment

    let outputPipe = Pipe()
    process.standardOutput = outputPipe
    process.standardError = outputPipe

    do {
      try process.run()
      serverProcess = process
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
        self?.refreshStatus()
      }
    } catch {
      showAlert(
        title: "Unable to start Weavr",
        message: "Make sure the Weavr CLI is installed.\n\nError: \(error.localizedDescription)",
        style: .warning
      )
    }
  }

  @objc private func stopServer() {
    // Try graceful shutdown via API first
    var request = URLRequest(url: baseURL.appendingPathComponent("api/shutdown"))
    request.httpMethod = "POST"
    request.timeoutInterval = 2.0

    URLSession.shared.dataTask(with: request) { [weak self] _, _, _ in
      DispatchQueue.main.async {
        // Also terminate our process if we started it
        if let process = self?.serverProcess, process.isRunning {
          process.terminate()
        }
        self?.serverProcess = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
          self?.refreshStatus()
        }
      }
    }.resume()
  }

  @objc private func restartServer() {
    stopServer()
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
      self?.startServer()
    }
  }

  @objc private func installWeavr() {
    let alert = NSAlert()
    alert.messageText = "Install Weavr CLI"
    alert.informativeText = "Choose your preferred installation method:"
    alert.addButton(withTitle: "Install via npm")
    alert.addButton(withTitle: "Install via Homebrew")
    alert.addButton(withTitle: "View Instructions")
    alert.addButton(withTitle: "Cancel")

    let response = alert.runModal()

    switch response {
    case .alertFirstButtonReturn:
      runInstallCommand("npm install -g @openweavr/weavr")
    case .alertSecondButtonReturn:
      runInstallCommand("brew install openweavr/tap/weavr")
    case .alertThirdButtonReturn:
      if let url = URL(string: "https://openweavr.ai/getting-started.html") {
        NSWorkspace.shared.open(url)
      }
    default:
      break
    }
  }

  private func runInstallCommand(_ command: String) {
    let script = """
    tell application "Terminal"
      activate
      do script "\(command)"
    end tell
    """

    if let appleScript = NSAppleScript(source: script) {
      var error: NSDictionary?
      appleScript.executeAndReturnError(&error)
      if let error = error {
        showAlert(title: "Error", message: "Failed to open Terminal: \(error)", style: .warning)
      }
    }
  }

  @objc private func toggleLaunchAtLogin() {
    do {
      if SMAppService.mainApp.status == .enabled {
        try SMAppService.mainApp.unregister()
      } else {
        try SMAppService.mainApp.register()
      }
    } catch {
      showAlert(title: "Error", message: "Failed to update login item: \(error.localizedDescription)", style: .warning)
    }
    updateMenuState()
  }

  @objc private func toggleAutoStart() {
    let current = UserDefaults.standard.bool(forKey: kAutoStartServer)
    UserDefaults.standard.set(!current, forKey: kAutoStartServer)
    updateMenuState()
  }

  @objc private func openLogs() {
    let logPaths = [
      "\(FileManager.default.homeDirectoryForCurrentUser.path)/Library/Logs/Weavr/serve.log",
      "/tmp/weavr.log"
    ]

    for path in logPaths {
      if FileManager.default.fileExists(atPath: path) {
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
        return
      }
    }

    showAlert(title: "No Logs Found", message: "No log files found. Start the server to generate logs.", style: .informational)
  }

  @objc private func openSettings() {
    NSWorkspace.shared.open(baseURL.appendingPathComponent("settings"))
  }

  @objc private func runWorkflow(_ sender: NSMenuItem) {
    guard let name = sender.representedObject as? String else { return }

    var request = URLRequest(url: baseURL.appendingPathComponent("api/workflows/\(name)/run"))
    request.httpMethod = "POST"

    URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
      DispatchQueue.main.async {
        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
          self?.showNotification(title: "Workflow Started", body: "\(name) is now running")
        } else {
          self?.showAlert(title: "Error", message: "Failed to run workflow: \(error?.localizedDescription ?? "Unknown error")", style: .warning)
        }
      }
    }.resume()
  }

  @objc private func quitApp() {
    NSApp.terminate(nil)
  }

  // MARK: - Helpers

  private func showOnboarding() {
    let alert = NSAlert()
    alert.messageText = "Welcome to Weavr!"
    alert.informativeText = """
    Weavr is a self-hosted workflow automation platform with AI agents.

    This launcher helps you:
    • Start and stop the Weavr server
    • Monitor your workflows
    • Quick access to the web interface

    Would you like to start the server now?
    """
    alert.addButton(withTitle: "Start Server")
    alert.addButton(withTitle: "Later")

    if !isWeavrInstalled {
      alert.informativeText += "\n\n⚠️ Weavr CLI is not installed. Install it first."
      alert.buttons[0].title = "Install Weavr"
    }

    let response = alert.runModal()
    UserDefaults.standard.set(true, forKey: kHasCompletedOnboarding)

    if response == .alertFirstButtonReturn {
      if isWeavrInstalled {
        startServer()
      } else {
        installWeavr()
      }
    }
  }

  private func showAlert(title: String, message: String, style: NSAlert.Style) {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = message
    alert.alertStyle = style
    alert.runModal()
  }

  private func showNotification(title: String, body: String) {
    let notification = NSUserNotification()
    notification.title = title
    notification.informativeText = body
    NSUserNotificationCenter.default.deliver(notification)
  }

  private func buildPathEnv() -> String {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "/usr/local/bin:/opt/homebrew/bin:\(home)/.local/bin:\(home)/bin:\(home)/.nvm/versions/node/v22.0.0/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  }

  private func parseWorkflows(data: Data) -> [(name: String, lastRun: Date?, status: String)]? {
    guard
      let json = try? JSONSerialization.jsonObject(with: data, options: []),
      let dict = json as? [String: Any],
      let workflows = dict["workflows"] as? [[String: Any]]
    else {
      return nil
    }

    return workflows.map { workflow in
      let name = workflow["name"] as? String ?? "Unnamed"
      let status = workflow["status"] as? String ?? "unknown"
      let lastRun = parseISODate(workflow["lastRun"] as? String)
      return (name: name, lastRun: lastRun, status: status)
    }
  }

  private func parseISODate(_ value: String?) -> Date? {
    guard let value = value else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
  }

  private func updateWorkflowMenu(items: [(name: String, lastRun: Date?, status: String)]) {
    // Remove old workflow items
    for item in workflowItems {
      menu.removeItem(item)
    }
    workflowItems.removeAll()

    let insertIndex = menu.index(of: workflowsHeaderItem) + 1

    if items.isEmpty {
      let emptyItem = NSMenuItem(title: "No workflows", action: nil, keyEquivalent: "")
      emptyItem.isEnabled = false
      let font = NSFont.systemFont(ofSize: 12)
      emptyItem.attributedTitle = NSAttributedString(
        string: "No workflows",
        attributes: [.font: font, .foregroundColor: NSColor.tertiaryLabelColor]
      )
      menu.insertItem(emptyItem, at: insertIndex)
      workflowItems.append(emptyItem)
      return
    }

    for (offset, item) in items.sorted(by: { $0.name < $1.name }).enumerated() {
      let statusIcon: String
      switch item.status {
      case "active": statusIcon = "●"
      case "paused": statusIcon = "◐"
      case "error": statusIcon = "✕"
      default: statusIcon = "○"
      }

      let statusColor: NSColor
      switch item.status {
      case "active": statusColor = .systemGreen
      case "paused": statusColor = .systemYellow
      case "error": statusColor = .systemRed
      default: statusColor = .secondaryLabelColor
      }

      let menuItem = NSMenuItem(title: "\(statusIcon) \(item.name)", action: #selector(runWorkflow(_:)), keyEquivalent: "")
      menuItem.target = self
      menuItem.representedObject = item.name

      // Submenu for workflow actions
      let submenu = NSMenu()
      let runItem = NSMenuItem(title: "Run Now", action: #selector(runWorkflow(_:)), keyEquivalent: "")
      runItem.target = self
      runItem.representedObject = item.name
      submenu.addItem(runItem)

      if let lastRun = item.lastRun {
        submenu.addItem(NSMenuItem.separator())
        let lastRunItem = NSMenuItem(title: "Last run: \(dateFormatter.string(from: lastRun))", action: nil, keyEquivalent: "")
        lastRunItem.isEnabled = false
        submenu.addItem(lastRunItem)
      }

      menuItem.submenu = submenu

      menu.insertItem(menuItem, at: insertIndex + offset)
      workflowItems.append(menuItem)
    }
  }
}

final class WeavrLauncherApp: NSObject, NSApplicationDelegate {
  private var statusController: StatusBarController?

  func applicationDidFinishLaunching(_ notification: Notification) {
    statusController = StatusBarController()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }
}
