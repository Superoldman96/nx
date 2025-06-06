import {
  addDependenciesToPackageJson,
  formatFiles,
  GeneratorCallback,
  joinPathFragments,
  readProjectConfiguration,
  runTasksInSerial,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { updateModuleFederationProject } from '../../rules/update-module-federation-project';
import applicationGenerator from '../application/application';
import { normalizeOptions } from '../application/lib/normalize-options';
import remoteGenerator from '../remote/remote';
import setupSsrGenerator from '../setup-ssr/setup-ssr';
import { addModuleFederationFiles } from './lib/add-module-federation-files';
import {
  normalizeRemoteDirectory,
  normalizeRemoteName,
} from './lib/normalize-remote';
import { setupSsrForHost } from './lib/setup-ssr-for-host';
import { updateModuleFederationE2eProject } from './lib/update-module-federation-e2e-project';
import { NormalizedSchema, Schema } from './schema';
import { addMfEnvToTargetDefaultInputs } from '../../utils/add-mf-env-to-inputs';
import { isValidVariable } from '@nx/js';
import {
  moduleFederationEnhancedVersion,
  nxVersion,
} from '../../utils/versions';
import { ensureRootProjectName } from '@nx/devkit/src/generators/project-name-and-root-utils';
import { updateModuleFederationTsconfig } from './lib/update-module-federation-tsconfig';
import { normalizeHostName } from './lib/normalize-host-name';

export async function hostGenerator(
  host: Tree,
  schema: Schema
): Promise<GeneratorCallback> {
  const tasks: GeneratorCallback[] = [];
  const name = await normalizeHostName(host, schema.directory, schema.name);
  const options: NormalizedSchema = {
    ...(await normalizeOptions<Schema>(host, {
      ...schema,
      name,
      useProjectJson: true,
    })),
    js: schema.js ?? false,
    typescriptConfiguration: schema.js
      ? false
      : schema.typescriptConfiguration ?? true,
    dynamic: schema.dynamic ?? false,
    // TODO(colum): remove when Webpack MF works with Crystal
    addPlugin: !schema.bundler || schema.bundler === 'rspack' ? true : false,
    bundler: schema.bundler ?? 'rspack',
  };

  // Check to see if remotes are provided and also check if --dynamic is provided
  // if both are check that the remotes are valid names else throw an error.
  if (options.dynamic && options.remotes?.length > 0) {
    options.remotes.forEach((remote) => {
      const isValidRemote = isValidVariable(remote);
      if (!isValidRemote.isValid) {
        throw new Error(
          `Invalid remote name provided: ${remote}. ${isValidRemote.message}`
        );
      }
    });
  }

  await ensureRootProjectName(options, 'application');
  const initTask = await applicationGenerator(host, {
    ...options,
    directory: options.appProjectRoot,
    name: options.name,
    // The target use-case is loading remotes as child routes, thus always enable routing.
    routing: true,
    skipFormat: true,
    useProjectJson: true,
  });
  tasks.push(initTask);

  const remotesWithPorts: { name: string; port: number }[] = [];

  if (schema.remotes) {
    let remotePort = options.devServerPort + 1;
    for (const remote of schema.remotes) {
      const remoteName = await normalizeRemoteName(host, remote, options);
      remotesWithPorts.push({ name: remoteName, port: remotePort });

      const remoteTask = await remoteGenerator(host, {
        name: remote,
        directory: normalizeRemoteDirectory(remote, options),
        style: options.style,
        unitTestRunner: options.unitTestRunner,
        e2eTestRunner: options.e2eTestRunner,
        linter: options.linter,
        devServerPort: remotePort,
        ssr: options.ssr,
        skipFormat: true,
        typescriptConfiguration: options.typescriptConfiguration,
        js: options.js,
        dynamic: options.dynamic,
        host: options.projectName,
        skipPackageJson: options.skipPackageJson,
        bundler: options.bundler,
      });
      tasks.push(remoteTask);
      remotePort++;
    }
  }

  addModuleFederationFiles(host, options, remotesWithPorts);
  updateModuleFederationProject(host, options, true);
  updateModuleFederationE2eProject(host, options);
  updateModuleFederationTsconfig(host, options);

  if (options.ssr) {
    if (options.bundler !== 'rspack') {
      const setupSsrTask = await setupSsrGenerator(host, {
        project: options.projectName,
        serverPort: options.devServerPort,
        skipFormat: true,
      });
      tasks.push(setupSsrTask);
    }

    const setupSsrForHostTask = await setupSsrForHost(
      host,
      options,
      options.projectName,
      remotesWithPorts
    );
    tasks.push(setupSsrForHostTask);

    const projectConfig = readProjectConfiguration(host, options.projectName);
    if (options.bundler !== 'rspack') {
      projectConfig.targets.server.options.webpackConfig = joinPathFragments(
        projectConfig.root,
        `webpack.server.config.${options.typescriptConfiguration ? 'ts' : 'js'}`
      );
    }
    updateProjectConfiguration(host, options.projectName, projectConfig);
  }

  if (!options.setParserOptionsProject) {
    host.delete(
      joinPathFragments(options.appProjectRoot, 'tsconfig.lint.json')
    );
  }

  addMfEnvToTargetDefaultInputs(host, options.bundler);

  const installTask = addDependenciesToPackageJson(
    host,
    { '@module-federation/enhanced': moduleFederationEnhancedVersion },
    {
      '@nx/web': nxVersion,
      '@nx/module-federation': nxVersion,
    }
  );
  tasks.push(installTask);

  if (!options.skipFormat) {
    await formatFiles(host);
  }

  return runTasksInSerial(...tasks);
}

export default hostGenerator;
