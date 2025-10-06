# PulseGen Backend

Video upload, sensitivity processing, and streaming backend API built with Node.js and Express.

## Description

PulseGen Backend is a robust REST API that handles video uploads, processing, and streaming with real-time communication capabilities. It provides secure authentication, video management, and user administration features.

## Features

- Video upload and processing with FFmpeg
- Real-time communication via Socket.io
- JWT-based authentication and authorization
- Rate limiting and security middleware
- MongoDB integration with Mongoose
- Image optimization with Sharp
- File upload handling with Multer
- CORS configuration for cross-origin requests

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT (jsonwebtoken)
- **Real-time**: Socket.io
- **File Processing**: FFmpeg, Sharp, Multer
- **Security**: Helmet, CORS, bcryptjs, express-rate-limit
- **Validation**: express-validator
- **Logging**: Morgan

## Prerequisites

- Node.js (v16 or higher)
- MongoDB
- FFmpeg

## Installation

1. Clone the repository
2. Navigate to the backend directory
3. Install dependencies:
   ```bash
   pnpm install
   ```

## Environment Variables

Create a `.env` file in the backend directory with the following variables:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/pulsegen
JWT_SECRET=your_jwt_secret_key
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

## Available Scripts

- `pnpm start` - Start the production server
- `pnpm dev` - Start the development server with nodemon
- `pnpm test` - Run tests (not implemented)

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout

### Videos
- `GET /api/videos` - Get all videos
- `POST /api/videos` - Upload new video
- `GET /api/videos/:id` - Get specific video
- `PUT /api/videos/:id` - Update video
- `DELETE /api/videos/:id` - Delete video

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile

### Health Check
- `GET /api/health` - Health check endpoint
- `GET /health` - Simple health check
- `GET /ping` - Ping endpoint

## Socket.io Events

- `connection` - Client connection
- `join-room` - Join user-specific room
- `disconnect` - Client disconnection

## Security Features

- Helmet for security headers
- CORS configuration
- Rate limiting (100 requests per 15 minutes)
- JWT token authentication
- Input validation and sanitization
- Secure file upload handling

## Deployed

Backend API: https://backend-pulsegen.onrender.com
