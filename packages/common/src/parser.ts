import express from 'express'
import type { Request, Response, NextFunction } from 'express'

const jsonParser = express.json();
const urlencodedParser = express.urlencoded({ extended: true });

export async function authBodyParser(req: Request, res: Response, next: NextFunction) {
  if (req.body !== undefined || req.readableEnded) {
    return next();
  }

  if (req.is('application/json')) {
    return jsonParser(req, res, next);
  }

  if (req.is('application/x-www-form-urlencoded')) {
    return urlencodedParser(req, res, next);
  }

  next();
}
