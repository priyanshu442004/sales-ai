import React, { useState } from 'react';
import { Button, Card, Badge, Modal } from '../components/ui/core';
import { 
  Play, Pause, Plus, Trash2, ArrowDown, Clock, 
  Mail, Linkedin, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface SequenceStep {
  id: string;
  stepNum: number;
  channel: 'Email' | 'LinkedIn' | 'Delay';
  title: string;
  delayDays?: number;
  description: string;
}

export const Sequences: React.FC = () => {
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<SequenceStep[]>([
    { id: '1', stepNum: 1, channel: 'LinkedIn', title: 'LinkedIn Connect Request', description: 'Send connection invite with personalized introductory hook.' },
    { id: '2', stepNum: 2, channel: 'Delay', title: 'Wait Period', delayDays: 2, description: 'Hold sequence execution for 2 days.' },
    { id: '3', stepNum: 3, channel: 'Email', title: 'Initial Cold Pitch Email', description: 'Direct SMTP outreach with case-study links.' },
    { id: '4', stepNum: 4, channel: 'Delay', title: 'Wait Period', delayDays: 4, description: 'Hold sequence execution for 4 days.' },
    { id: '5', stepNum: 5, channel: 'LinkedIn', title: 'LinkedIn Follow-up Message', description: 'Brief soft-reminder referencing the previous email.' },
  ]);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newStepType, setNewStepType] = useState<'Email' | 'LinkedIn' | 'Delay'>('Email');
  const [newStepDelay, setNewStepDelay] = useState(3);
  const [newStepDesc, setNewStepDesc] = useState('');

  const handleAddStep = () => {
    const nextStepNum = steps.length + 1;
    let title = '';
    let desc = newStepDesc;

    if (newStepType === 'Delay') {
      title = `Wait Period`;
      desc = `Hold sequence execution for ${newStepDelay} days.`;
    } else {
      title = `${newStepType} Sequence Step`;
      if (!desc) desc = `Automated ${newStepType} message sequence hook.`;
    }

    const newStep: SequenceStep = {
      id: `step-${Date.now()}`,
      stepNum: nextStepNum,
      channel: newStepType,
      title,
      delayDays: newStepType === 'Delay' ? newStepDelay : undefined,
      description: desc
    };

    setSteps([...steps, newStep]);
    setAddModalOpen(false);
    setNewStepDesc('');
    toast.success('Sequence step added successfully.');
  };

  const handleDeleteStep = (id: string) => {
    const filtered = steps.filter(s => s.id !== id);
    // Reindex step numbers
    const reindexed = filtered.map((s, idx) => ({ ...s, stepNum: idx + 1 }));
    setSteps(reindexed);
    toast.warning('Sequence step removed.');
  };

  const getStepIcon = (channel: SequenceStep['channel']) => {
    switch (channel) {
      case 'Email':
        return <Mail className="w-5 h-5 text-brand-primary" />;
      case 'LinkedIn':
        return <Linkedin className="w-5 h-5 text-status-info" />;
      case 'Delay':
        return <Clock className="w-5 h-5 text-status-warning" />;
    }
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Outreach Sequences</h1>
          <p className="text-xs text-text-secondary mt-1">Design multi-step messaging workflows crossing email and social networking channels.</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button 
            variant={isActive ? 'secondary' : 'primary'}
            onClick={() => {
              setIsActive(!isActive);
              toast.info(isActive ? 'Sequence execution paused.' : 'Sequence execution activated.');
            }}
          >
            {isActive ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
            {isActive ? 'Pause Sequence' : 'Activate Sequence'}
          </Button>
          <Button variant="primary" onClick={() => setAddModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Step
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Steps Visualizer (60%) */}
        <div className="lg:col-span-2 space-y-4">
          {steps.map((step, idx) => (
            <React.Fragment key={step.id}>
              <Card className="p-4 border border-border-default hover:border-brand-primary/50 transition">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-full bg-bg-canvas flex items-center justify-center border border-border-subtle font-heading font-bold text-xs text-text-secondary">
                      {step.stepNum}
                    </div>
                    <div className="p-2 bg-brand-primary/5 rounded-btn">
                      {getStepIcon(step.channel)}
                    </div>
                    <div>
                      <h4 className="text-sm font-heading font-bold text-text-primary">{step.title}</h4>
                      <p className="text-xs text-text-secondary mt-0.5">{step.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    {step.channel === 'Delay' && (
                      <Badge variant="warning">{step.delayDays}d delay</Badge>
                    )}
                    <button 
                      onClick={() => handleDeleteStep(step.id)}
                      className="p-1 rounded text-text-tertiary hover:text-status-danger hover:bg-bg-canvas transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Card>
              
              {idx < steps.length - 1 && (
                <div className="flex justify-center my-1">
                  <ArrowDown className="w-5 h-5 text-text-tertiary" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Right Side: Execution Controls / Trigger limits (40%) */}
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-heading font-bold text-text-primary">Trigger Settings & Rules</h3>
            <div className="space-y-3 text-xs text-text-secondary">
              
              <div className="space-y-2 border-b border-border-subtle pb-3">
                <span className="font-heading font-semibold text-text-primary block">Sequence Exit Criteria</span>
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-border-default text-brand-primary mr-2" />
                  <span>Exit immediately on reply</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-border-default text-brand-primary mr-2" />
                  <span>Exit on booking a meeting</span>
                </label>
              </div>

              <div className="space-y-3 pt-2">
                <span className="font-heading font-semibold text-text-primary block">Delivery Limits</span>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Max sends per day (workspace)</span>
                    <span className="font-semibold text-text-primary font-mono">150 / day</span>
                  </div>
                  <input type="range" min={10} max={300} defaultValue={150} className="w-full accent-brand-primary" />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span>Sending schedule timezone</span>
                    <span className="font-semibold text-text-primary">Prospect's local time</span>
                  </div>
                  <select className="px-2 py-1 bg-bg-canvas border border-border-default rounded w-full text-xs text-text-secondary focus:outline-none">
                    <option>Prospect's local time (recommended)</option>
                    <option>EST (US Eastern)</option>
                    <option>PST (US Pacific)</option>
                    <option>GMT (London)</option>
                  </select>
                </div>
              </div>

            </div>
          </Card>

          <Card className="p-5 bg-bg-canvas/50 border border-border-subtle flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-brand-primary shrink-0" />
            <div className="text-xs text-text-secondary">
              <span className="font-heading font-semibold text-text-primary block">Integrations Active</span>
              LinkedIn sequence dispatching runs through connected Unipile session (status: Connected). Email sent via Google OAuth (SMTP).
            </div>
          </Card>
        </div>

      </div>

      {/* Add Step Modal */}
      <Modal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Add Sequence Step"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Step Channel</label>
            <div className="grid grid-cols-3 gap-2">
              {(['Email', 'LinkedIn', 'Delay'] as const).map(ch => (
                <button
                  key={ch}
                  onClick={() => setNewStepType(ch)}
                  className={`py-2 border text-xs font-heading font-semibold rounded-btn transition ${
                    newStepType === ch 
                      ? 'bg-brand-primary text-white border-brand-primary' 
                      : 'bg-bg-canvas text-text-secondary border-border-default'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          {newStepType === 'Delay' ? (
            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Wait Duration (days)</label>
              <input
                type="number"
                min={1}
                max={30}
                value={newStepDelay}
                onChange={(e) => setNewStepDelay(Number(e.target.value))}
                className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Step Description</label>
              <textarea
                rows={3}
                value={newStepDesc}
                onChange={(e) => setNewStepDesc(e.target.value)}
                placeholder="e.g. Follow up email offering case study link"
                className="p-3 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
              />
            </div>
          )}

          <div className="flex justify-end space-x-2 border-t border-border-subtle pt-3">
            <Button variant="secondary" size="sm" onClick={() => setAddModalOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAddStep}>Add Step</Button>
          </div>
        </div>
      </Modal>

    </div>
  );
};
