import type { Request, Response, NextFunction } from "express";

// API key authentication middleware
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];
  
  // Skip API key check for web interface and webhook endpoints
  if (req.path.startsWith('/webhook') || !req.path.startsWith('/api/v1')) {
    return next();
  }

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key'
    });
  }

  next();
}

// Rate limiting middleware
export function rateLimit(req: Request, res: Response, next: NextFunction) {
  // TODO: Implement rate limiting based on API key or IP
  next();
}

// Request validation middleware
export function validateRequest(req: Request, res: Response, next: NextFunction) {
  const { method, path } = req;
  
  // Validate required fields for different endpoints
  if (path.startsWith('/api/v1/calls') && method === 'POST') {
    const { contactNumber } = req.body;
    if (!contactNumber) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Contact number is required'
      });
    }
  }
  
  if (path.startsWith('/api/v1/messages') && method === 'POST') {
    const { contactNumber, content } = req.body;
    if (!contactNumber || !content) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Contact number and content are required'
      });
    }
  }

  next();
}
