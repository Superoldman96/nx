import axios from 'axios';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { compare, gt, major, minor, parse } from 'semver';
import {
  getAngularCliMigrationDocs,
  getAngularCliMigrationGenerator,
  getAngularCliMigrationGeneratorSpec,
} from './files/angular-cli-upgrade-migration';

const migrationGeneratorPrefix = 'update-angular-cli-version-';

async function addMigrationPackageGroup(
  angularPackageMigrations: Record<string, any>,
  targetNxVersion: string,
  targetNxMigrationVersion: string,
  packageVersionMap: Map<string, string>,
  isPrerelease: boolean
) {
  angularPackageMigrations.packageJsonUpdates[targetNxVersion] = {
    version: `${targetNxMigrationVersion}`,
  };

  const promptAndRequirements = await getPromptAndRequiredVersions(
    packageVersionMap
  );
  if (!promptAndRequirements) {
    console.warn(
      '❗️ - The `@angular/core` latest version is greater than the next version. Skipping generating migration prompt and requirements.\n' +
        '     Please review the migrations and manually add the prompt and requirements if needed.'
    );
  } else {
    angularPackageMigrations.packageJsonUpdates[targetNxVersion][
      'x-prompt'
    ] = `Do you want to update the Angular version to ${promptAndRequirements.promptVersion}?`;
    angularPackageMigrations.packageJsonUpdates[targetNxVersion].requires = {
      '@angular/core': promptAndRequirements.angularCoreRequirement,
    };
  }

  angularPackageMigrations.packageJsonUpdates[targetNxVersion].packages = {};
  for (const [pkgName, version] of packageVersionMap) {
    if (
      pkgName.startsWith('@angular/') &&
      ![
        '@angular/core',
        '@angular/material',
        '@angular/cdk',
        '@angular/google-maps',
        '@angular/ssr',
        '@angular/pwa',
        '@angular/build',
      ].includes(pkgName)
    ) {
      continue;
    }

    angularPackageMigrations.packageJsonUpdates[targetNxVersion].packages[
      pkgName
    ] = {
      version: isPrerelease ? version : `~${version}`,
      alwaysAddToPackageJson: pkgName === '@angular/core',
    };
  }
}

async function getPromptAndRequiredVersions(
  packageVersionMap: Map<string, string>
): Promise<{
  angularCoreRequirement: string;
  promptVersion: string;
} | null> {
  // @angular/core
  const angularCoreMetadata = await axios.get(
    'https://registry.npmjs.org/@angular/core'
  );
  const { latest, next } = angularCoreMetadata.data['dist-tags'];
  if (gt(latest, next)) {
    return null;
  }
  const angularCoreRequirement = `>=${major(latest)}.${minor(
    latest
  )}.0 <${next}`;

  // prompt version (e.g. v16 or v16.1)
  const angularCoreVersion = packageVersionMap.get('@angular/core');
  const { major: majorVersion, minor: minorVersion } =
    parse(angularCoreVersion)!;
  const promptVersion = `v${majorVersion}${
    minorVersion !== 0 ? `.${minorVersion}` : ''
  }`;

  return { angularCoreRequirement, promptVersion };
}

function findPreviousVersion(
  packageUpdates: Record<
    string,
    {
      version: string;
      packages: Record<string, { version: string }>;
    }
  >,
  angularCoreNewVersion: string
): string {
  const sortedUpdates = Object.values(packageUpdates).sort((a, b) =>
    compare(b.version, a.version)
  );

  const {
    major: newMajorVersion,
    minor: newMinorVersion,
    patch: newPatchVersion,
  } = parse(angularCoreNewVersion)!;

  const previousUpdate = sortedUpdates.find((update: any) => {
    if (!update.packages['@angular/core']) {
      return false;
    }

    const {
      major: updateMajorVersion,
      minor: updateMinorVersion,
      patch: updatePatchVersion,
    } = parse(update.packages['@angular/core'].version.replace(/^[~^]/, ''))!;

    return (
      updateMajorVersion !== newMajorVersion ||
      updateMinorVersion !== newMinorVersion ||
      updatePatchVersion !== newPatchVersion
    );
  })!;

  return previousUpdate.packages['@angular/core'].version.replace(/^[~^]/, '');
}

function deletePreviousPrereleaseMigration(
  angularPackageMigrations: Record<string, any>,
  angularCoreVersion: string
) {
  const { major, minor, patch } = parse(angularCoreVersion)!;

  const existingMigration = Object.keys(
    angularPackageMigrations.generators
  ).find((migration) => {
    if (!migration.startsWith(migrationGeneratorPrefix)) {
      return false;
    }

    const angularCliVersion = migration.replace(migrationGeneratorPrefix, '');

    if (!/^[0-9]+-[0-9]+-[0-9]+-.*$/.test(angularCliVersion)) {
      return false;
    }

    const [existingMajor, existingMinor, existingPatch] =
      angularCliVersion.split('-');

    return (
      +existingMajor === major &&
      +existingMinor === minor &&
      +existingPatch === patch
    );
  });

  if (existingMigration) {
    delete angularPackageMigrations.generators[existingMigration];
  }
}

export async function buildMigrations(
  packageVersionMap: Map<string, string>,
  targetNxVersion: string,
  targetNxMigrationVersion: string,
  isPrerelease: boolean
) {
  console.log('⏳ - Writing migrations...');
  const pathToMigrationsJsonFile = 'packages/angular/migrations.json';
  const angularPackageMigrations = JSON.parse(
    readFileSync(pathToMigrationsJsonFile, { encoding: 'utf-8' })
  );
  const previousVersion = findPreviousVersion(
    angularPackageMigrations.packageJsonUpdates,
    packageVersionMap.get('@angular/core')!
  );

  await addMigrationPackageGroup(
    angularPackageMigrations,
    targetNxVersion,
    targetNxMigrationVersion,
    packageVersionMap,
    isPrerelease
  );

  const angularCLIVersion = packageVersionMap.get('@angular/cli') as string;
  const angularCliMigrationGeneratorContents = getAngularCliMigrationGenerator(
    angularCLIVersion,
    isPrerelease
  );
  const angularCliMigrationGeneratorSpecContents =
    getAngularCliMigrationGeneratorSpec();

  const { major, minor } = parse(angularCLIVersion)!;
  const newVersion = `${major}.${minor}.0`;
  const angularCliMigrationDocsContents = getAngularCliMigrationDocs(
    previousVersion,
    newVersion
  );

  // Create the directory update-targetNxVersion.dasherize()
  // Write the generator
  // Update angularPackageMigrations

  const migrationGeneratorFolderName =
    'update-' + targetNxVersion.replace(/\./g, '-');
  const migrationFileName = 'update-angular-cli';
  const generatorName = `${migrationGeneratorPrefix}${angularCLIVersion.replace(
    /\./g,
    '-'
  )}`;

  const angularCoreVersion = packageVersionMap.get('@angular/core')!;

  if (isPrerelease) {
    deletePreviousPrereleaseMigration(
      angularPackageMigrations,
      angularCoreVersion
    );
  }

  angularPackageMigrations.generators[generatorName] = {
    cli: 'nx',
    version: targetNxMigrationVersion,
    requires: {
      '@angular/core': `>=${angularCoreVersion}`,
    },
    description: `Update the @angular/cli package version to ${
      isPrerelease ? angularCLIVersion : `~${angularCLIVersion}`
    }.`,
    factory: `./src/migrations/${migrationGeneratorFolderName}/${migrationFileName}`,
  };

  writeFileSync(
    pathToMigrationsJsonFile,
    JSON.stringify(angularPackageMigrations, null, 2)
  );

  const pathToMigrationFolder = join(
    'packages/angular/src/migrations',
    migrationGeneratorFolderName
  );
  if (!existsSync(pathToMigrationFolder)) {
    mkdirSync(pathToMigrationFolder);
  }

  const pathToMigrationGeneratorFile = join(
    pathToMigrationFolder,
    `${migrationFileName}.ts`
  );
  const pathToMigrationGeneratorSpecFile = join(
    pathToMigrationFolder,
    `${migrationFileName}.spec.ts`
  );
  const pathToMigrationDocsFile = join(
    pathToMigrationFolder,
    `${migrationFileName}.md`
  );
  writeFileSync(
    pathToMigrationGeneratorFile,
    angularCliMigrationGeneratorContents
  );
  writeFileSync(
    pathToMigrationGeneratorSpecFile,
    angularCliMigrationGeneratorSpecContents
  );
  writeFileSync(pathToMigrationDocsFile, angularCliMigrationDocsContents);

  console.log('✅ - Wrote migrations');
}
