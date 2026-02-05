import AppKit

let app = NSApplication.shared
let delegate = WeavrLauncherApp()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
