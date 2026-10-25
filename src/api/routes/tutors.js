import { Router } from 'express';
import { AppError } from '../errors/app-error.js';

const allowedMethods = 'GET, HEAD, OPTIONS';

export function createTutorRouter({ tutorController }) {
  const router = Router();
  router.route('/')
    .get(tutorController.list)
    .options((req, res) => res.set('Allow', allowedMethods).status(204).end())
    .all((req, res, next) => {
      res.set('Allow', allowedMethods);
      next(new AppError(405, 'METHOD_NOT_ALLOWED', 'Tutors can only be read.'));
    });
  return router;
}
