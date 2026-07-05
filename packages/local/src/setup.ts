export type ServiceSetupWorkflow = {
  installAgent: () => void;
  installSkill?: () => void;
  installService: () => void;
  startService: () => void;
  waitForReady: () => Promise<void>;
  pair: () => Promise<void>;
  printReloadHint: () => void;
};

export async function runServiceSetupWorkflow(workflow: ServiceSetupWorkflow, options: {
  installSkill: boolean;
}): Promise<void> {
  workflow.installAgent();
  if (options.installSkill) {
    workflow.installSkill?.();
  }
  workflow.installService();
  workflow.startService();
  await workflow.waitForReady();
  await workflow.pair();
  workflow.printReloadHint();
}
