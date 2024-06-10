import fs from 'fs';
import { glob } from 'glob';
import * as tsNode from 'ts-node';
import chalk from 'chalk';
import path from 'path';
import { build } from 'tsup';
import { SyncConfigType, localFileService } from '@nangohq/shared';
import type { StandardNangoConfig } from '@nangohq/shared';

import configService from './config.service.js';
import { getNangoRootPath, printDebug } from '../utils.js';
import { loadYamlAndGeneratedModel } from './model.service.js';
import parserService from './parser.service.js';

const ALLOWED_IMPORTS = ['url', 'crypto', 'zod', 'node:url', 'node:crypto'];

export async function compileAllFiles({
    debug,
    fullPath,
    scriptName,
    providerConfigKey,
    type
}: {
    debug: boolean;
    fullPath: string;
    scriptName?: string;
    providerConfigKey?: string;
    type?: string;
}): Promise<boolean> {
    const tsconfig = fs.readFileSync(`${getNangoRootPath()}/tsconfig.dev.json`, 'utf8');

    const distDir = path.join(fullPath, 'dist');
    if (!fs.existsSync(distDir)) {
        if (debug) {
            printDebug(`Creating ${distDir} directory`);
        }
        fs.mkdirSync(distDir);
    }

    const configs = await loadYamlAndGeneratedModel({ fullPath, debug });

    const compilerOptions = (JSON.parse(tsconfig) as { compilerOptions: Record<string, any> }).compilerOptions;
    const compiler = tsNode.create({
        skipProject: true, // when installed locally we don't want ts-node to pick up the package tsconfig.json file
        compilerOptions
    });

    if (debug) {
        printDebug(`Compiler options: ${JSON.stringify(compilerOptions, null, 2)}`);
    }

    let scriptDirectory = fullPath;
    if (scriptName && providerConfigKey && type) {
        scriptDirectory = localFileService.resolveTsFileLocation({ scriptName, providerConfigKey, type });
        console.log(chalk.green(`Compiling ${scriptName}.ts in ${scriptDirectory}`));
    }

    const integrationFiles = listFilesToCompile({ scriptName, fullPath, config: configs, debug });
    let success = true;

    const modelNames = configService.getModelNames(configs);

    for (const file of integrationFiles) {
        try {
            const completed = await compile({ fullPath, file, config: configs, modelNames, compiler, debug });
            if (!completed) {
                if (scriptName && file.inputPath.includes(scriptName)) {
                    success = false;
                }
            }
        } catch (error) {
            console.log(chalk.red(`Error compiling "${file.inputPath}":`));
            console.error(error);
            success = false;
        }
    }

    return success;
}

export async function compileSingleFile({
    fullPath,
    file,
    config,
    modelNames,
    tsconfig,
    debug = false
}: {
    fullPath: string;
    file: ListedFile;
    tsconfig: string;
    config: StandardNangoConfig[];
    modelNames: string[];
    debug: boolean;
}) {
    try {
        const compiler = tsNode.create({
            skipProject: true, // when installed locally we don't want ts-node to pick up the package tsconfig.json file
            compilerOptions: JSON.parse(tsconfig).compilerOptions
        });

        const result = await compile({
            fullPath,
            file,
            config,
            modelNames,
            compiler,
            debug
        });

        return result;
    } catch (error) {
        console.error(`Error compiling ${file.inputPath}:`);
        console.error(error);
        return false;
    }
}

function compileImportedFile({
    fullPath,
    filePath,
    compiler,
    type,
    modelNames
}: {
    fullPath: string;
    filePath: string;
    compiler: tsNode.Service;
    type: SyncConfigType | undefined;
    modelNames: string[];
}): boolean {
    let finalResult = true;
    const importedFiles = parserService.getImportedFiles(filePath);

    if (!parserService.callsAreUsedCorrectly(filePath, type, modelNames)) {
        return false;
    }

    for (const importedFile of importedFiles) {
        const importedFilePath = path.resolve(path.dirname(filePath), importedFile);
        const importedFilePathWithExtension = importedFilePath + '.ts';

        /// if it is a library import then we can skip it
        if (!fs.existsSync(importedFilePathWithExtension)) {
            // if the library is not allowed then we should let the user know
            // that it is not allowed and won't work early on
            if (!ALLOWED_IMPORTS.includes(importedFile)) {
                console.log(chalk.red(`Importing libraries is not allowed. Please remove the import "${importedFile}" from "${path.basename(filePath)}"`));
                return false;
            }
            continue;
        }

        // if the file is not in the nango-integrations directory
        // then we should not compile it
        // if the parts of the path are shorter than the current that means it is higher
        // than the nango-integrations directory
        if (importedFilePathWithExtension.split(path.sep).length < fullPath.split(path.sep).length) {
            const importedFileName = path.basename(importedFilePathWithExtension);

            console.log(
                chalk.red(
                    `All imported files must live within the nango-integrations directory. Please move "${importedFileName}" into the nango-integrations directory.`
                )
            );
            return false;
        }

        if (importedFilePathWithExtension.includes('models.ts')) {
            continue;
        }

        compiler.compile(fs.readFileSync(importedFilePathWithExtension, 'utf8'), importedFilePathWithExtension);
        console.log(chalk.green(`Compiled "${importedFilePathWithExtension}" successfully`));

        finalResult = compileImportedFile({ fullPath, filePath: importedFilePath + '.ts', compiler, type, modelNames });
    }

    return finalResult;
}

async function compile({
    fullPath,
    file,
    config,
    modelNames,
    compiler,
    debug = false
}: {
    fullPath: string;
    file: ListedFile;
    config: StandardNangoConfig[];
    compiler: tsNode.Service;
    modelNames: string[];
    debug: boolean;
}): Promise<boolean> {
    const providerConfiguration = localFileService.getProviderConfigurationFromPath(file.inputPath, config);

    if (!providerConfiguration) {
        return false;
    }

    const syncConfig = [...providerConfiguration.syncs, ...providerConfiguration.actions].find((sync) => sync.name === file.baseName);
    const type = syncConfig?.type || SyncConfigType.SYNC;

    const success = compileImportedFile({ fullPath, filePath: file.inputPath, compiler, type, modelNames });

    if (!success) {
        return false;
    }

    compiler.compile(fs.readFileSync(file.inputPath, 'utf8'), file.inputPath);

    const dirname = path.dirname(file.outputPath);
    const extname = path.extname(file.outputPath);
    const basename = path.basename(file.outputPath, extname);

    const fileNameWithExtension = `${basename}-${providerConfiguration.providerConfigKey}${extname}`;
    const outputPath = path.join(dirname, fileNameWithExtension);

    if (debug) {
        printDebug(`Compiling ${file.inputPath} -> ${outputPath}`);
    }

    await build({
        entryPoints: [file.inputPath],
        tsconfig: getNangoRootPath() + '/tsconfig.dev.json',
        skipNodeModulesBundle: true,
        silent: !debug,
        outDir: path.join(fullPath, 'dist'),
        onSuccess: async () => {
            if (fs.existsSync(file.outputPath)) {
                await fs.promises.rename(file.outputPath, outputPath);
                console.log(chalk.green(`Compiled "${file.inputPath}" successfully`));
            } else {
                console.log(chalk.red(`Failed to compile "${file.inputPath}"`));
            }
            return;
        }
    });

    return true;
}

export interface ListedFile {
    inputPath: string;
    outputPath: string;
    baseName: string;
}

export function getFileToCompile({ fullPath, filePath }: { fullPath: string; filePath: string }): ListedFile {
    return {
        inputPath: filePath,
        outputPath: path.join(fullPath, '/dist/', path.basename(filePath, '.ts') + '.cjs'),
        baseName: path.basename(filePath, '.ts')
    };
}

export function listFilesToCompile({
    fullPath,
    scriptName,
    config,
    debug
}: {
    fullPath: string;
    scriptName?: string | undefined;
    config: StandardNangoConfig[];
    debug?: boolean;
}): ListedFile[] {
    let files: string[] = [];
    if (scriptName) {
        if (debug) {
            printDebug(`Compiling ${scriptName}.ts`);
        }

        files = [`${fullPath}/${scriptName}.ts`];
    } else {
        files = glob.sync(`${fullPath}/*.ts`);

        // models.ts is the one expected file
        if (files.length === 1 && debug) {
            printDebug(`No files found in the root: ${fullPath}`);
        }

        if (config) {
            config.forEach((providerConfig) => {
                const syncPath = `${providerConfig.providerConfigKey}/syncs`;
                const actionPath = `${providerConfig.providerConfigKey}/actions`;
                const postConnectionPath = `${providerConfig.providerConfigKey}/post-connection-scripts`;

                files = [
                    ...files,
                    ...glob.sync(`${fullPath}/${syncPath}/*.ts`),
                    ...glob.sync(`${fullPath}/${actionPath}/*.ts`),
                    ...glob.sync(`${fullPath}/${postConnectionPath}/*.ts`)
                ];

                if (debug) {
                    if (glob.sync(`${fullPath}/${syncPath}/*.ts`).length > 0) {
                        printDebug(`Found nested sync files in ${syncPath}`);
                    }
                    if (glob.sync(`${fullPath}/${actionPath}/*.ts`).length > 0) {
                        printDebug(`Found nested action files in ${actionPath}`);
                    }
                    if (glob.sync(`${fullPath}/${postConnectionPath}/*.ts`).length > 0) {
                        printDebug(`Found nested post connection script files in ${postConnectionPath}`);
                    }
                }
            });
        }
    }

    return files.map((filePath) => {
        return getFileToCompile({ fullPath, filePath });
    });
}
