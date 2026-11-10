import type { Request, Response, NextFunction } from 'express';
import { DocumentService } from './document.service.js';
import { DocumentListQuerySchema } from '@mindvault/shared';
import { AppError } from '../../middleware/errorHandler.js';

export class DocumentController {
  constructor(private documentService: DocumentService = new DocumentService()) {}

  /**
   * Resolves the authoritative workspace ID, prioritizing the verified identity
   * established by the authorizeWorkspace middleware.
   */
  private getAuthorizedWorkspaceId(req: Request): string {
    const workspaceId =
      req.workspaceMember?.workspaceId ||
      (req.headers['x-workspace-id'] as string) ||
      (req.query?.workspaceId as string) ||
      (req.body?.workspaceId as string);

    if (!workspaceId) {
      throw new AppError(400, 'WORKSPACE_ID_REQUIRED', 'workspaceId is required');
    }
    return workspaceId;
  }

  public upload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        throw new AppError(
          400,
          'NO_FILE_PROVIDED',
          'A document file must be uploaded under field name "file"',
        );
      }

      const workspaceId = this.getAuthorizedWorkspaceId(req);
      const userId = req.user!.id;

      const doc = await this.documentService.uploadDocument({
        workspaceId,
        uploadedById: userId,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });

      res.status(202).json({
        success: true,
        data: doc,
        meta: {
          timestamp: new Date().toISOString(),
          message: 'Document accepted for asynchronous processing',
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workspaceId = this.getAuthorizedWorkspaceId(req);

      const query = DocumentListQuerySchema.parse(req.query);
      const result = await this.documentService.listDocuments(workspaceId, query);

      res.status(200).json({
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const documentId = req.params.id;
      const workspaceId = this.getAuthorizedWorkspaceId(req);

      const doc = await this.documentService.getDocumentById(workspaceId, documentId);

      res.status(200).json({
        success: true,
        data: doc,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public getStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const documentId = req.params.id;
      const workspaceId = this.getAuthorizedWorkspaceId(req);

      const status = await this.documentService.getDocumentStatus(workspaceId, documentId);

      res.status(200).json({
        success: true,
        data: status,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const documentId = req.params.id;
      const workspaceId = this.getAuthorizedWorkspaceId(req);

      await this.documentService.deleteDocument(workspaceId, documentId);

      res.status(200).json({
        success: true,
        data: {
          message: 'Document and associated vector data deleted successfully',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public download = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const documentId = req.params.id;
      const workspaceId = this.getAuthorizedWorkspaceId(req);

      const { buffer, originalName, mimeType } = await this.documentService.downloadDocument(
        workspaceId,
        documentId,
      );

      res.setHeader('Content-Type', mimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(originalName)}"`,
      );
      res.setHeader('Content-Length', buffer.length);
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };
}
