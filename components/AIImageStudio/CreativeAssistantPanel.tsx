import React from 'react';
import type { CreativeConcept, StudioState } from './types';
import GuidedCreativeCopilot, { type GenerateOverrides } from './GuidedCreativeCopilot';

interface CreativeAssistantPanelProps {
  state: StudioState;
  onDispatch: (action: unknown) => void;
  onClose?: () => void;
  onGenerate?: (overrides?: GenerateOverrides) => void;
  onDevelopInWriter?: (concept: CreativeConcept) => void;
  onDevelopPromptInWriter?: (prompt: string) => void;
}

const CreativeAssistantPanel: React.FC<CreativeAssistantPanelProps> = (props) => (
  <GuidedCreativeCopilot {...props} />
);

export default CreativeAssistantPanel;
