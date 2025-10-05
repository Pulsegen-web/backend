import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { validateVideoFile } from './videoProcessor.js';

const ensureUploadDirectories = async () => {
  const directories = [
    'uploads/videos',
    'uploads/thumbnails',
    'uploads/temp'
  ];

  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`Error creating directory ${dir}:`, error);
    }
  }
};

ensureUploadDirectories();

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const uploadPath = 'uploads/videos';
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    try {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext);
      const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
      
      const filename = `${sanitizedBaseName}-${uniqueSuffix}${ext}`;
      cb(null, filename);
    } catch (error) {
      cb(error);
    }
  }
});

const fileFilter = (req, file, cb) => {
  try {
    validateVideoFile(file);
    cb(null, true);
  } catch (error) {
    cb(new Error(error.message), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 1024,
    files: 1
  }
});

const memoryStorage = multer.memoryStorage();
const uploadMemory = multer({
  storage: memoryStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1
  }
});

export { upload, uploadMemory };