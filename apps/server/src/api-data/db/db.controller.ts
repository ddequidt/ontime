import {
  DatabaseModel,
  ErrorResponse,
  GetInfo,
  MessageResponse,
  ProjectData,
  ProjectFileListResponse,
} from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import { join } from 'path';
import { existsSync } from 'fs';
import type { Request, Response } from 'express';

import { failEmptyObjects } from '../../utils/routerUtils.js';
import { resolveDbDirectory, resolveProjectsDirectory } from '../../setup/index.js';

import * as projectService from '../../services/project-service/ProjectService.js';
import { ensureJsonExtension } from '../../utils/fileManagement.js';
import { generateUniqueFileName } from '../../utils/generateUniqueFilename.js';
import { appStateService } from '../../services/app-state-service/AppStateService.js';

export async function patchPartialProjectFile(req: Request, res: Response<DatabaseModel | ErrorResponse>) {
  // all fields are optional in validation
  if (failEmptyObjects(req.body, res)) {
    res.status(400).send({ message: 'No field found to patch' });
    return;
  }

  try {
    const { rundown, project, settings, viewSettings, urlPresets, customFields, osc, http } = req.body;
    const patchDb: DatabaseModel = { rundown, project, settings, viewSettings, urlPresets, customFields, osc, http };

    const newData = await projectService.applyDataModel(patchDb);
    res.status(200).send(newData);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

/**
 * Creates a new project file.
 * Receives the project filename (`filename`) from the request body.
 *
 * @param {Request} req - The express request object. Expects `filename` in the request body.
 * @param {Response} res - The express response object. Sends a 200 status with a success message upon successful creation,
 *                         a 409 status if there are validation errors,
 *                         or a 500 status with an error message in case of an exception.
 */
export async function createProjectFile(req: Request, res: Response<{ filename: string } | ErrorResponse>) {
  try {
    const originalFilename = ensureJsonExtension(req.body.title || 'Untitled');
    const filename = generateUniqueFileName(resolveProjectsDirectory, originalFilename);
    const errors = projectService.validateProjectFiles({ newFilename: filename });

    if (errors.length) {
      return res.status(409).send({ message: 'Project with title already exists' });
    }

    const newProjectData: ProjectData = {
      title: req.body?.title ?? '',
      description: req.body?.description ?? '',
      publicUrl: req.body?.publicUrl ?? '',
      publicInfo: req.body?.publicInfo ?? '',
      backstageUrl: req.body?.backstageUrl ?? '',
      backstageInfo: req.body?.backstageInfo ?? '',
    };

    projectService.createProjectFile(filename, newProjectData);

    res.status(200).send({
      filename,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

/**
 * Utility function finds the correct project file to download
 */
function selectProjectFile(fileName?: string) {
  const projectsDirectory = resolveDbDirectory;
  const fileToDownload = fileName ? ensureJsonExtension(fileName) : projectService.getProjectTitle();
  const pathToFile = join(projectsDirectory, fileToDownload);

  return { pathToFile, name: fileToDownload };
}

/**
 * Allows downloading of a optionally given project files
 * If no {filename} is provided, loaded file will be served
 */
export async function projectDownload(req: Request, res: Response) {
  const { pathToFile, name } = selectProjectFile(req.body?.fileName);

  // Check if the file exists before attempting to download
  if (!existsSync(pathToFile)) {
    return res.status(404).send({ message: `Project ${name} not found.` });
  }

  res.download(pathToFile, name, (error) => {
    if (error) {
      const message = getErrorMessage(error);
      res.status(500).send({ message });
    }
  });
}

/**
 * uploads, parses and applies the data from a given file
 */
export async function postProjectFile(req: Request, res: Response<MessageResponse | ErrorResponse>) {
  if (!req.file) {
    res.status(400).send({ message: 'File not found' });
    return;
  }

  try {
    const options = req.query;
    const { filename, path } = req.file;

    await projectService.handleUploadedFile(path, filename);
    await projectService.applyProjectFile(filename, options);

    res.status(201).send({
      message: `Loaded project ${filename}`,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

/**
 * Retrieves and lists all project files from the uploads directory.
 */
export async function listProjects(_req: Request, res: Response<ProjectFileListResponse | ErrorResponse>) {
  try {
    const data = await projectService.getProjectList();
    res.status(200).send(data);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

/**
 * Receives a `filename` from the request body and loads the project file from the uploads directory.
 */
export async function loadProject(req: Request, res: Response<MessageResponse | ErrorResponse>) {
  try {
    const name = req.body.filename;
    if (!projectService.doesProjectExist(name)) {
      return res.status(404).send({ message: 'File not found' });
    }

    await projectService.applyProjectFile(name);

    res.status(201).send({
      message: `Loaded project ${name}`,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

/**
 * Duplicates a project file.
 * Receives the original project filename (`filename`) from the request parameters
 * and the filename for the duplicate (`newFilename`) from the request body.
 *
 * @param {Request} req - The express request object. Expects `filename` in the request parameters and `newFilename` in the request body.
 * @param {Response} res - The express response object. Sends a 201 status with a success message upon successful duplication,
 *                         a 409 status if there are validation errors,
 *                         or a 500 status with an error message in case of an exception.
 */
export async function duplicateProjectFile(req: Request, res: Response<MessageResponse | ErrorResponse>) {
  try {
    const { filename } = req.params;
    const { newFilename } = req.body;

    const errors = projectService.validateProjectFiles({ filename, newFilename });

    if (errors.length) {
      return res.status(409).send({ message: errors.join(', ') });
    }

    await projectService.duplicateProjectFile(filename, newFilename);

    res.status(201).send({
      message: `Duplicated project ${filename} to ${newFilename}`,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

/**
 * Renames a project file.
 * Receives the current filename (`filename`) from the request parameters
 * and the new filename (`newFilename`) from the request body.
 *
 * @param {Request} req - The express request object. Expects `filename` in the request parameters and `newFilename` in the request body.
 * @param {Response} res - The express response object. Sends a 201 status with a success message upon successful renaming,
 *                         a 409 status if there are validation errors,
 *                         or a 500 status with an error message in case of an exception.
 */
export async function renameProjectFile(req: Request, res: Response<MessageResponse | ErrorResponse>) {
  try {
    const { newFilename } = req.body;
    const { filename } = req.params;

    const errors = projectService.validateProjectFiles({ filename, newFilename });

    if (errors.length) {
      return res.status(409).send({ message: errors.join(', ') });
    }

    // Rename the file
    await projectService.renameProjectFile(filename, newFilename);

    res.status(201).send({
      message: `Renamed project ${filename} to ${newFilename}`,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

/**
 * Deletes an existing project file.
 * Receives the project filename (`filename`) from the request parameters.
 *
 * @param {Request} req - The express request object. Expects `filename` in the request parameters.
 * @param {Response} res - The express response object. Sends a 204 status with a success message upon successful deletion,
 *                         a 403 status if attempting to delete the currently loaded project,
 *                         a 409 status if there are validation errors,
 *                         or a 500 status with an error message in case of an exception.
 */
export async function deleteProjectFile(req: Request, res: Response<MessageResponse | ErrorResponse>) {
  try {
    const { filename } = req.params;

    const { lastLoadedProject } = await appStateService.get();

    if (lastLoadedProject === filename) {
      return res.status(403).send({ message: 'Cannot delete currently loaded project' });
    }

    const errors = projectService.validateProjectFiles({ filename });

    if (errors.length) {
      return res.status(409).send({ message: errors.join(', ') });
    }

    await projectService.deleteProjectFile(filename);

    res.status(204).send({
      message: `Deleted project ${filename}`,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).send({ message });
  }
}

export async function getInfo(_req: Request, res: Response<GetInfo>) {
  const info = await projectService.getInfo();
  res.status(200).send(info);
}
