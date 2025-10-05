import express from 'express';
import { body, query, validationResult } from 'express-validator';
import User from '../models/User.js';
import Video from '../models/Video.js';
import Organization from '../models/Organization.js';
import { authorizeRoles } from '../middleware/auth.js';

const router = express.Router();
router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('organizationId', 'name settings');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    const videoStats = await Video.aggregate([
      {
        $match: {
          uploadedBy: user._id,
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          totalVideos: { $sum: 1 },
          totalViews: { $sum: '$viewCount' },
          totalSize: { $sum: '$fileSize' },
          statusBreakdown: {
            $push: '$status'
          },
          sensitivityBreakdown: {
            $push: '$sensitivityAnalysis.result'
          }
        }
      }
    ]);

    const stats = videoStats[0] || {
      totalVideos: 0,
      totalViews: 0,
      totalSize: 0,
      statusBreakdown: [],
      sensitivityBreakdown: []
    };
    const statusCounts = stats.statusBreakdown.reduce((acc, status) => {
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const sensitivityCounts = stats.sensitivityBreakdown.reduce((acc, result) => {
      if (result) acc[result] = (acc[result] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          role: user.role,
          organizationId: user.organizationId._id,
          lastLogin: user.lastLogin,
          profileImage: user.profileImage,
          createdAt: user.createdAt
        },
        organization: {
          id: user.organizationId._id,
          name: user.organizationId.name,
          settings: user.organizationId.settings
        },
        statistics: {
          videos: {
            total: stats.totalVideos,
            totalViews: stats.totalViews,
            totalSizeBytes: stats.totalSize,
            byStatus: statusCounts,
            bySensitivity: sensitivityCounts
          }
        }
      }
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving user profile'
    });
  }
});
router.put('/profile', [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name must be between 1 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name must be between 1 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email')
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

    const allowedUpdates = ['firstName', 'lastName', 'email'];
    const updates = {};

    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    if (updates.email) {
      const existingUser = await User.findOne({
        email: updates.email,
        _id: { $ne: req.user._id }
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email is already taken by another user'
        });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    ).select('-password').populate('organizationId', 'name');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser._id,
          username: updatedUser.username,
          email: updatedUser.email,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          fullName: updatedUser.fullName,
          role: updatedUser.role,
          organizationId: updatedUser.organizationId._id
        }
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
});
router.put('/password', [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number')
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

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password'
    });
  }
});
router.get('/organization', authorizeRoles('admin'), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('role').optional().isIn(['viewer', 'editor', 'admin']).withMessage('Invalid role'),
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
    const query = { 
      organizationId: req.user.organizationId,
      isActive: true
    };

    if (req.query.role) {
      query.role = req.query.role;
    }

    if (req.query.search) {
      query.$or = [
        { firstName: { $regex: req.query.search, $options: 'i' } },
        { lastName: { $regex: req.query.search, $options: 'i' } },
        { username: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await User.countDocuments(query);
    const usersWithStats = await Promise.all(users.map(async (user) => {
      const videoCount = await Video.countDocuments({
        uploadedBy: user._id,
        isActive: true
      });

      return {
        ...user,
        videoCount
      };
    }));

    res.json({
      success: true,
      data: {
        users: usersWithStats,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get organization users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving organization users'
    });
  }
});
router.put('/:userId/role', authorizeRoles('admin'), [
  body('role')
    .isIn(['viewer', 'editor', 'admin'])
    .withMessage('Invalid role')
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

    const { role } = req.body;
    const { userId } = req.params;
    const user = await User.findOne({
      _id: userId,
      organizationId: req.user.organizationId,
      isActive: true
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in your organization'
      });
    }
    if (user._id.toString() === req.user._id.toString() && role !== 'admin') {
      const adminCount = await User.countDocuments({
        organizationId: req.user.organizationId,
        role: 'admin',
        isActive: true
      });

      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot remove admin role - at least one admin must remain'
        });
      }
    }
    user.role = role;
    await user.save();

    res.json({
      success: true,
      message: 'User role updated successfully',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        }
      }
    });

  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user role'
    });
  }
});
router.put('/:userId/deactivate', authorizeRoles('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findOne({
      _id: userId,
      organizationId: req.user.organizationId,
      isActive: true
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in your organization'
      });
    }
    if (user._id.toString() === req.user._id.toString()) {
      const adminCount = await User.countDocuments({
        organizationId: req.user.organizationId,
        role: 'admin',
        isActive: true
      });

      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate yourself - at least one admin must remain active'
        });
      }
    }
    user.isActive = false;
    await user.save();

    res.json({
      success: true,
      message: 'User deactivated successfully'
    });

  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deactivating user'
    });
  }
});
router.get('/dashboard-stats', authorizeRoles('editor', 'admin'), async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const videoStats = await Video.aggregate([
      {
        $match: {
          organizationId: organizationId,
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          totalVideos: { $sum: 1 },
          totalViews: { $sum: '$viewCount' },
          totalSize: { $sum: '$fileSize' },
          avgDuration: { $avg: '$duration' },
          statusBreakdown: { $push: '$status' },
          sensitivityBreakdown: { $push: '$sensitivityAnalysis.result' }
        }
      }
    ]);

    const stats = videoStats[0] || {
      totalVideos: 0,
      totalViews: 0,
      totalSize: 0,
      avgDuration: 0,
      statusBreakdown: [],
      sensitivityBreakdown: []
    };
    const recentVideos = await Video.find({
      organizationId: organizationId,
      isActive: true
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('uploadedBy', 'username firstName lastName')
    .lean();
    const userCount = await User.countDocuments({
      organizationId: organizationId,
      isActive: true
    });
    const statusCounts = stats.statusBreakdown.reduce((acc, status) => {
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const sensitivityCounts = stats.sensitivityBreakdown.reduce((acc, result) => {
      if (result) acc[result] = (acc[result] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        summary: {
          totalVideos: stats.totalVideos,
          totalViews: stats.totalViews,
          totalUsers: userCount,
          totalStorageBytes: stats.totalSize,
          avgDurationSeconds: Math.round(stats.avgDuration || 0)
        },
        videosByStatus: statusCounts,
        videosBySensitivity: sensitivityCounts,
        recentVideos: recentVideos.map(video => ({
          id: video._id,
          title: video.title,
          status: video.status,
          sensitivityResult: video.sensitivityAnalysis.result,
          uploadedBy: video.uploadedBy,
          createdAt: video.createdAt,
          fileUrl: `/uploads/${video.filename}`,
          thumbnailUrl: video.thumbnail ? `/uploads/thumbnails/${video.thumbnail}` : null
        }))
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving dashboard statistics'
    });
  }
});

export default router;