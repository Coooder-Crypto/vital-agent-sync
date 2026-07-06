export type ServiceSetupWorkflow = {
  installAgent: () => void;
  installSkill?: () => void;
  installService: () => void;
  startService: () => void;
  waitForReady: () => Promise<void>;
  pair: () => Promise<void>;
  printReloadHint: () => void;
};

export type ServiceEnsureWorkflow = {
  getStatus: () => {
    installed: boolean;
    running: boolean;
  };
  installService: () => void;
  startService: () => void;
  waitForReady: () => Promise<void>;
  printStatus?: () => Promise<void> | void;
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

export async function runServiceEnsureWorkflow(workflow: ServiceEnsureWorkflow): Promise<void> {
  let status = workflow.getStatus();
  if (!status.installed) {
    workflow.installService();
    status = workflow.getStatus();
  }
  if (!status.running) {
    workflow.startService();
  }
  await workflow.waitForReady();
  await workflow.printStatus?.();
}
