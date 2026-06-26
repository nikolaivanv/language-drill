export { OnboardingShell } from './onboarding-shell';
export { OnboardingProvider, useOnboarding } from './onboarding-context';
export { ProgressRail } from './progress-rail';
export { MobileOnboardingHeader } from './mobile-onboarding-header';
export { WizardProgress } from './wizard-progress';
export { WizardFooter } from './wizard-footer';

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
