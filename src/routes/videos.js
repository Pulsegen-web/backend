import express from 'express';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { body, query, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import Video from '../models/Video.js';
import User from '../models/User.js';
import { upload } from '../utils/upload.js';
import { 
  analyzeSensitivity, 
  extractVideoMetadata, 
  generateThumbnail,
  optimizeVideoForStreaming
} from '../utils/videoProcessor.js';
import { authenticateToken, authorizeRoles, checkMultiTenant } from '../middleware/auth.js';

const router = express.Router();

router.post('/upload', authenticateToken, upload.single('video'), [
  body('title')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title is required and must be less than 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  body('visibility')
    .optional()
    .isIn(['private', 'organization', 'public'])
    .withMessage('Invalid visibility option'),
  body('tags')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try {
          const tags = JSON.parse(value);
          if (!Array.isArray(tags)) throw new Error();
          return true;
        } catch {
          throw new Error('Tags must be a valid JSON array');
        }
      }
      return true;
    })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.file) {
        await fsPromises.unlink(req.file.path).catch(console.error);
      }
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Video file is required'
      });
    }

    const { title, description = '', visibility = 'private', tags: tagsString = '[]' } = req.body;
    const tags = JSON.parse(tagsString);

    const video = new Video({
      title,
      description,
      filename: req.file.filename,
      originalName: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id,
      organizationId: req.user.organizationId,
      visibility,
      tags: tags.map(tag => tag.trim()).filter(tag => tag.length > 0),
      status: 'processing'
    });

    await video.save();

    const io = req.app.get('io');

    io.to(`user_${req.user._id}`).emit('video-upload-complete', {
      videoId: video._id,
      title: video.title,
      filename: video.filename,
      timestamp: new Date()
    });

    processVideoAsync(video, io);

    res.status(201).json({
      success: true,
      message: 'Video uploaded successfully and processing started',
      data: {
        video: {
          id: video._id,
          title: video.title,
          description: video.description,
          filename: video.filename,
          originalName: video.originalName,
          fileSize: video.fileSize,
          status: video.status,
          processingProgress: video.processingProgress,
          visibility: video.visibility,
          tags: video.tags,
          createdAt: video.createdAt
        }
      }
    });

  } catch (error) {
    console.error('Video upload error:', error);
    
    if (req.file) {
      await fsPromises.unlink(req.file.path).catch(console.error);
    }

    res.status(500).json({
      success: false,
      message: 'Error uploading video'
    });
  }
});

const processVideoAsync = async (video, io) => {
  try {
    await video.updateProgress(10, 'processing');
    io.to(`user_${video.uploadedBy}`).emit('video-processing-progress', {
      videoId: video._id,
      progress: 10,
      status: 'processing',
      message: 'Starting video processing...',
      timestamp: new Date()
    });

    const metadata = await extractVideoMetadata(video.filePath);
    video.metadata = metadata;
    video.duration = metadata.duration;
    video.resolution = metadata.resolution;
    await video.updateProgress(20);
    
    io.to(`user_${video.uploadedBy}`).emit('video-processing-progress', {
      videoId: video._id,
      progress: 20,
      message: 'Metadata extracted...',
      timestamp: new Date()
    });

    const optimizedDir = 'uploads/optimized';
    const optimizedPath = path.join(optimizedDir, `${video._id}.mp4`);
    await optimizeVideoForStreaming(video.filePath, optimizedPath);
    video.optimizedPath = optimizedPath;
    await video.updateProgress(40);

    io.to(`user_${video.uploadedBy}`).emit('video-processing-progress', {
      videoId: video._id,
      progress: 40,
      message: 'Video optimized for streaming...',
      timestamp: new Date()
    });

    const thumbnailsDir = 'uploads/thumbnails';
    const thumbnail = await generateThumbnail(video.filePath, thumbnailsDir);
    video.thumbnail = thumbnail;
    await video.updateProgress(60);

    io.to(`user_${video.uploadedBy}`).emit('video-processing-progress', {
      videoId: video._id,
      progress: 60,
      message: 'Thumbnail generated...',
      timestamp: new Date()
    });

    video.sensitivityAnalysis.status = 'processing';
    await video.save();
    
    io.to(`user_${video.uploadedBy}`).emit('video-processing-progress', {
      videoId: video._id,
      progress: 80,
      message: 'Starting sensitivity analysis...',
      timestamp: new Date()
    });

    const analysisResults = await analyzeSensitivity(video.filePath, video._id, io);
    
    video.sensitivityAnalysis = {
      ...video.sensitivityAnalysis,
      ...analysisResults
    };
    
    await video.updateProgress(100, 'completed');
    const userId = video.uploadedBy.toString();
    console.log(`Emitting video-processing-complete to room: user_${userId}`);
    io.to(`user_${userId}`).emit('video-processing-complete', {
      videoId: video._id,
      title: video.title,
      sensitivityResult: analysisResults.result,
      timestamp: new Date()
    });

  } catch (error) {
    console.error('Video processing error:', error);
    video.status = 'failed';
    video.sensitivityAnalysis.status = 'failed';
    await video.save();

    io.to(`user_${video.uploadedBy}`).emit('video-processing-error', {
      videoId: video._id,
      error: error.message,
      timestamp: new Date()
    });
  }
};
router.get('/', authenticateToken, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('status').optional().isIn(['uploading', 'processing', 'completed', 'failed', 'archived']),
  query('sensitivity').optional().isIn(['safe', 'flagged', 'under-review']),
  query('search').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const query = { organizationId: req.user.organizationId, isActive: true };
    if (req.user.role !== 'admin') {
      query.$or = [
        { uploadedBy: req.user._id },
        { visibility: 'organization' },
        { visibility: 'public' }
      ];
    }
    if (req.query.status) {
      query.status = req.query.status;
    }

    if (req.query.sensitivity) {
      query['sensitivityAnalysis.result'] = req.query.sensitivity;
    }

    if (req.query.search) {
      query.$text = { $search: req.query.search };
    }
    const videos = await Video.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('uploadedBy', 'username firstName lastName')
      .lean();

    const total = await Video.countDocuments(query);
    const videosWithUrls = videos.map(video => ({
      ...video,
      fileUrl: `/uploads/${video.filename}`,
      thumbnailUrl: video.thumbnail ? `/uploads/thumbnails/${video.thumbnail}` : null
    }));

    res.json({
      success: true,
      data: {
        videos: videosWithUrls,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalVideos: total,
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving videos'
    });
  }
});
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
      isActive: true
    }).populate('uploadedBy', 'username firstName lastName');

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }
    if (!video.canBeViewedBy(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this video'
      });
    }
    video.viewCount += 1;
    video.lastViewedAt = new Date();
    await video.save();

    res.json({
      success: true,
      data: {
        video: {
          ...video.toObject(),
          fileUrl: `/uploads/${video.filename}`,
          thumbnailUrl: video.thumbnail ? `/uploads/thumbnails/${video.thumbnail}` : null
        }
      }
    });

  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving video'
    });
  }
});
router.get('/:id/stream', async (req, res) => {
  try {
    let token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token required' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }
    if (!video.isActive || video.status !== 'completed') {
      return res.status(404).json({
        success: false,
        message: `Video not ready for streaming. Status: ${video.status}`
      });
    }
    if (!video.canBeViewedBy(user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this video'
      });
    }
    const videoPath = video.optimizedPath || video.filePath;
    const filePath = path.resolve(videoPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Video file not found on disk'
      });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const corsHeaders = {
      'Access-Control-Allow-Origin': req.headers.origin || 'http://localhost:5173',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
    };

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });

      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': video.mimeType,
        ...corsHeaders
      };

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': video.mimeType,
        ...corsHeaders
      };

      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }

  } catch (error) {
    console.error('Video streaming error:', error);
    res.status(500).json({
      success: false,
      message: 'Error streaming video'
    });
  }
});
router.put('/:id', authenticateToken, authorizeRoles('editor', 'admin'), [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  body('visibility')
    .optional()
    .isIn(['private', 'organization', 'public'])
    .withMessage('Invalid visibility option'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const video = await Video.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
      isActive: true
    });

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }
    if (req.user.role !== 'admin' && video.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - you can only edit your own videos'
      });
    }
    const allowedUpdates = ['title', 'description', 'visibility', 'tags'];
    const updates = {};
    
    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const updatedVideo = await Video.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate('uploadedBy', 'username firstName lastName');

    res.json({
      success: true,
      message: 'Video updated successfully',
      data: {
        video: {
          ...updatedVideo.toObject(),
          fileUrl: `/uploads/${updatedVideo.filename}`,
          thumbnailUrl: updatedVideo.thumbnail ? `/uploads/thumbnails/${updatedVideo.thumbnail}` : null
        }
      }
    });

  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating video'
    });
  }
});
router.delete('/:id', authenticateToken, authorizeRoles('editor', 'admin'), async (req, res) => {
  try {
    const video = await Video.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
      isActive: true
    });

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }
    if (req.user.role !== 'admin' && video.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - you can only delete your own videos'
      });
    }
    video.isActive = false;
    video.status = 'archived';
    await video.save();

    res.json({
      success: true,
      message: 'Video deleted successfully'
    });

  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting video'
    });
  }
});
router.post('/:id/reanalyze', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }
    video.sensitivityAnalysis.status = 'processing';
    await video.save();
    const io = req.app.get('socketio');
    const analysisResults = await analyzeSensitivity(video.filePath, video._id, io);
    video.sensitivityAnalysis = {
      ...video.sensitivityAnalysis,
      ...analysisResults
    };
    
    await video.save();

    res.json({
      success: true,
      message: 'Sensitivity analysis completed',
      data: {
        sensitivityAnalysis: video.sensitivityAnalysis
      }
    });

  } catch (error) {
    console.error('Re-analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Error re-analyzing video',
      error: error.message
    });
  }
});

export default router;