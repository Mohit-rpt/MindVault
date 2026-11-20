import { Request, Response, NextFunction, Router } from 'express';
import multer from 'multer';
import { DocumentController } from './document.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorizeWorkspace } from '../../middleware/authorizeWorkspace.js';
import { distributedUploadRateLimiter } from '../../middleware/redisRateLimiter.js';
import { MAX_FILE_SIZE_BYTES } from './document.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
});

/**
 * Pre-upload workspace guard (§SEC-01).
 * If x-workspace-id header or ?workspaceId query parameter is provided,
 * verifies workspace authorization BEFORE Multer consumes the multipart stream.
 */
const preUploadWorkspaceGuard = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers['x-workspace-id'] || req.query?.workspaceId) {
    return authorizeWorkspace('MEMBER')(req, res, next);
  }
  next();
};

export function createDocumentRouter(
  controller: DocumentController = new DocumentController(),
): Router {
  const router = Router();

  // All document routes require authentication
  router.use(authenticate);

  // POST /api/documents/upload - Multipart file upload with rate limiting and pre-auth buffer protection
  router.post(
    '/upload',
    distributedUploadRateLimiter,
    preUploadWorkspaceGuard,
    upload.single('file'),
    authorizeWorkspace('MEMBER'),
    controller.upload,
  );

  // GET /api/documents - List documents in workspace
  router.get('/', authorizeWorkspace('MEMBER'), controller.list);

  // GET /api/documents/:id - Get document details
  router.get('/:id', authorizeWorkspace('MEMBER'), controller.getById);

  // GET /api/documents/:id/status - Get document ingestion status
  router.get('/:id/status', authorizeWorkspace('MEMBER'), controller.getStatus);

  // GET /api/documents/:id/download - Stream/download original document
  router.get('/:id/download', authorizeWorkspace('MEMBER'), controller.download);

  // DELETE /api/documents/:id - Delete document, chunks, and storage file (ADMIN or OWNER required)
  router.delete('/:id', authorizeWorkspace('ADMIN'), controller.delete);

  return router;
}

export const documentRouter = createDocumentRouter();
