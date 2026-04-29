export { OnboardingShell } from './onboarding-shell';
export { OnboardingProvider, useOnboarding } from './onboarding-context';
export { CoachPane } from './coach-pane';
export { MobileCoachHeader } from './mobile-coach-header';
export { WizardProgress } from './wizard-progress';
export { WizardFooter } from './wizard-footer';
export { PlacementTestCallout } from './placement-test-callout';

export { StepLanguages } from './steps/step-languages';
export { StepLevel } from './steps/step-level';
export { StepGoals } from './steps/step-goals';
export { StepSchedule } from './steps/step-schedule';

export {
  initialNewUserState,
  initialEditState,
  type OnboardingState,
  type OnboardingAction,
} from './use-onboarding-reducer';
