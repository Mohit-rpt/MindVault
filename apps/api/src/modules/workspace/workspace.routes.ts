import { Router } from 'express';
import { workspaceController } from './workspace.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorizeWorkspace } from '../../middleware/authorizeWorkspace.js';

export const workspaceRouter: Router = Router();

// All workspace endpoints require an authenticated user
workspaceRouter.use(authenticate);

workspaceRouter.post('/', (req, res, next) => {
  workspaceController.create(req, res, next);
});

workspaceRouter.get('/', (req, res, next) => {
  workspaceController.list(req, res, next);
});

workspaceRouter.get('/:id', authorizeWorkspace('MEMBER'), (req, res, next) => {
  workspaceController.getById(req, res, next);
});

workspaceRouter.patch('/:id', authorizeWorkspace('ADMIN'), (req, res, next) => {
  workspaceController.update(req, res, next);
});

workspaceRouter.delete('/:id', authorizeWorkspace('OWNER'), (req, res, next) => {
  workspaceController.delete(req, res, next);
});
