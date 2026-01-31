import { WorkflowBuilder } from '../components/WorkflowBuilder';

export function Builder() {
  const handleSave = async (yaml: string) => {
    console.log('Saving workflow:', yaml);
    // In a real app, this would save via API
    alert('Workflow saved!\n\n' + yaml);
  };

  return (
    <div style={{ height: 'calc(100vh - 64px)' }}>
      <WorkflowBuilder onSave={handleSave} />
    </div>
  );
}
