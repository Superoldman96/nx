import {
  Tree,
  names,
  generateFiles,
  getPackageManagerCommand,
  formatFiles,
  detectPackageManager,
  readNxJson,
} from '@nx/devkit';
import { join } from 'path';
import { getNxCloudUrl, isNxCloudUsed } from 'nx/src/utils/nx-cloud-utils';
import { deduceDefaultBase } from 'nx/src/utils/default-base';

function getCiCommands(ci: Schema['ci']): Command[] {
  switch (ci) {
    case 'circleci': {
      return [
        {
          comments: [
            `# Nx Affected runs only tasks affected by the changes in this PR/commit. Learn more: https://nx.dev/ci/features/affected.`,
            `# Change from check to check-ci if you turn on the atomizer. Learn more: https://nx.dev/nx-api/gradle#splitting-e2e-tests.`,
          ],
        },
        {
          command: `./nx affected --base=$NX_BASE --head=$NX_HEAD -t assemble check`,
        },
      ];
    }
    default: {
      return [
        {
          comments: [
            `# Nx Affected runs only tasks affected by the changes in this PR/commit. Learn more: https://nx.dev/ci/features/affected.`,
            `# Change from check to check-ci if you turn on the atomizer. Learn more: https://nx.dev/nx-api/gradle#splitting-tests`,
          ],
        },
        { command: `./nx affected -t assemble check` },
      ];
    }
  }
}

export type Command = { command: string } | { comments: string[] } | string;

export interface Schema {
  name: string;
  ci: 'github' | 'circleci';
  packageManager?: null;
  commands?: Command[];
}

export async function ciWorkflowGenerator(tree: Tree, schema: Schema) {
  const ci = schema.ci;

  const options = getTemplateData(tree, schema);
  generateFiles(tree, join(__dirname, 'files', ci), '', options);
  await formatFiles(tree);
}

interface Substitutes {
  mainBranch: string;
  workflowName: string;
  workflowFileName: string;
  packageManager: string;
  packageManagerPrefix: string;
  commands: Command[];
  nxCloudHost: string;
  connectedToCloud: boolean;
}

function getTemplateData(tree: Tree, options: Schema): Substitutes {
  const { name: workflowName, fileName: workflowFileName } = names(
    options.name
  );
  const packageManager = detectPackageManager();
  const { exec: packageManagerPrefix } =
    getPackageManagerCommand(packageManager);

  let nxCloudHost: string = 'nx.app';
  try {
    const nxCloudUrl = getNxCloudUrl(readNxJson(tree));
    nxCloudHost = new URL(nxCloudUrl).host;
  } catch {}

  const mainBranch = deduceDefaultBase();

  const commands = options.commands ?? getCiCommands(options.ci);

  const connectedToCloud = isNxCloudUsed(readNxJson(tree));

  return {
    workflowName,
    workflowFileName,
    packageManager,
    packageManagerPrefix,
    commands,
    mainBranch,
    nxCloudHost,
    connectedToCloud,
  };
}

export default ciWorkflowGenerator;
