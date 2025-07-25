/**
 * Adapted from the original ng-packagr source.
 *
 * Changes made:
 * - Resolve `piscina` from the installed `ng-packagr` package.
 * - Additionally search for the TailwindCSS config in the workspace root.
 */

import { workspaceRoot } from '@nx/devkit';
import browserslist from 'browserslist';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { getNgPackagrVersionInfo } from '../ng-packagr-version';
import { importNgPackagrPath } from '../package-imports';

const maxWorkersVariable = process.env['NG_BUILD_MAX_WORKERS'];
const maxThreads =
  typeof maxWorkersVariable === 'string' && maxWorkersVariable !== ''
    ? +maxWorkersVariable
    : 4;

export enum CssUrl {
  inline = 'inline',
  none = 'none',
}

export class StylesheetProcessor {
  private renderWorker: any | undefined;

  constructor(
    private readonly projectBasePath: string,
    private readonly basePath: string,
    private readonly cssUrl?: CssUrl,
    private readonly includePaths?: string[],
    private readonly cacheDirectory?: string | false
  ) {
    // By default, browserslist defaults are too inclusive
    // https://github.com/browserslist/browserslist/blob/83764ea81ffaa39111c204b02c371afa44a4ff07/index.js#L516-L522
    // We change the default query to browsers that Angular support.
    // https://angular.io/guide/browser-support
    (browserslist.defaults as string[]) = [
      'last 2 Chrome versions',
      'last 1 Firefox version',
      'last 2 Edge major versions',
      'last 2 Safari major versions',
      'last 2 iOS major versions',
      'Firefox ESR',
    ];
  }

  async process({
    filePath,
    content,
  }: {
    filePath: string;
    content: string;
  }): Promise<string> {
    this.createRenderWorker();

    return this.renderWorker.run({ content, filePath });
  }

  /** Destory workers in pool. */
  destroy(): void {
    void this.renderWorker?.destroy();
  }

  private createRenderWorker(): Promise<void> {
    if (this.renderWorker) {
      return;
    }

    const styleIncludePaths = [...this.includePaths];
    let prevDir = null;
    let currentDir = this.basePath;

    while (currentDir !== prevDir) {
      const p = join(currentDir, 'node_modules');
      if (existsSync(p)) {
        styleIncludePaths.push(p);
      }

      prevDir = currentDir;
      currentDir = dirname(prevDir);
    }

    const browserslistData = browserslist(undefined, { path: this.basePath });

    const {
      findTailwindConfiguration,
      generateSearchDirectories,
      loadPostcssConfiguration,
    } = require('ng-packagr/lib/styles/postcss-configuration');

    let searchDirs = generateSearchDirectories([this.projectBasePath]);
    const postcssConfiguration = loadPostcssConfiguration(searchDirs);
    // (nx-specific): we support loading the TailwindCSS config from the root of the workspace
    searchDirs = generateSearchDirectories([
      this.projectBasePath,
      workspaceRoot,
    ]);
    const tailwindConfigPath = findTailwindConfiguration(searchDirs);

    const { major: ngPackagrMajorVersion } = getNgPackagrVersionInfo();
    const { colors } = importNgPackagrPath<
      typeof import('ng-packagr/src/lib/utils/color')
    >('ng-packagr/src/lib/utils/color', ngPackagrMajorVersion);
    const Piscina = getPiscina();

    this.renderWorker = new Piscina({
      filename: require.resolve(
        'ng-packagr/lib/styles/stylesheet-processor-worker'
      ),
      maxThreads,
      recordTiming: false,
      env: {
        ...process.env,
        FORCE_COLOR: '' + colors.enabled,
      },
      workerData: {
        postcssConfiguration,
        tailwindConfigPath,
        projectBasePath: this.projectBasePath,
        browserslistData,
        targets: transformSupportedBrowsersToTargets(browserslistData),
        cacheDirectory: this.cacheDirectory,
        cssUrl: this.cssUrl,
        styleIncludePaths,
      },
    });
  }
}

function transformSupportedBrowsersToTargets(
  supportedBrowsers: string[]
): string[] {
  const transformed: string[] = [];

  // https://esbuild.github.io/api/#target
  const esBuildSupportedBrowsers = new Set([
    'safari',
    'firefox',
    'edge',
    'chrome',
    'ios',
  ]);

  for (const browser of supportedBrowsers) {
    let [browserName, version] = browser.split(' ');

    // browserslist uses the name `ios_saf` for iOS Safari whereas esbuild uses `ios`
    if (browserName === 'ios_saf') {
      browserName = 'ios';
    }

    // browserslist uses ranges `15.2-15.3` versions but only the lowest is required
    // to perform minimum supported feature checks. esbuild also expects a single version.
    [version] = version.split('-');

    if (esBuildSupportedBrowsers.has(browserName)) {
      if (browserName === 'safari' && version === 'tp') {
        // esbuild only supports numeric versions so `TP` is converted to a high number (999) since
        // a Technology Preview (TP) of Safari is assumed to support all currently known features.
        version = '999';
      }

      transformed.push(browserName + version);
    }
  }

  return transformed.length ? transformed : undefined;
}

/**
 * Loads the `piscina` package from the installed `ng-packagr` package.
 */
function getPiscina() {
  const ngPackagrPath = getInstalledNgPackagrPath();

  try {
    // Resolve the main piscina module entry point
    const piscinaModulePath = require.resolve('piscina', {
      paths: [ngPackagrPath],
    });

    return require(piscinaModulePath);
  } catch (error) {
    throw new Error(
      `Failed to load the \`piscina\` package from \`ng-packagr\` dependencies: ${error.message}`
    );
  }
}

function getInstalledNgPackagrPath(): string {
  try {
    const ngPackagrPackageJsonPath = require.resolve('ng-packagr/package.json');
    return dirname(ngPackagrPackageJsonPath);
  } catch (e) {
    throw new Error(
      'The `ng-packagr` package is not installed. The package is required to use this executor. Please install it in your workspace.'
    );
  }
}
