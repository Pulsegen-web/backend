import mongoose from 'mongoose';

const videoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Video title is required'],
    trim: true,
    maxlength: [200, 'Title must be less than 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description must be less than 1000 characters']
  },
  filename: {
    type: String,
    required: [true, 'Filename is required']
  },
  originalName: {
    type: String,
    required: [true, 'Original filename is required']
  },
  filePath: {
    type: String,
    required: [true, 'File path is required']
  },
  optimizedPath: {
    type: String,
    default: null
  },
  fileSize: {
    type: Number,
    required: [true, 'File size is required']
  },
  mimeType: {
    type: String,
    required: [true, 'MIME type is required']
  },
  duration: {
    type: Number,
    default: 0
  },
  resolution: {
    width: {
      type: Number,
      default: 0
    },
    height: {
      type: Number,
      default: 0
    }
  },
  thumbnail: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['uploading', 'processing', 'completed', 'failed', 'archived'],
    default: 'uploading'
  },
  processingProgress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  sensitivityAnalysis: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'skipped'],
      default: 'pending'
    },
    result: {
      type: String,
      enum: ['safe', 'flagged', 'under-review'],
      default: null
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100,
      default: null
    },
    flaggedContent: {
      violence: { type: Boolean, default: false },
      adult: { type: Boolean, default: false },
      hate: { type: Boolean, default: false },
      drugs: { type: Boolean, default: false },
      weapons: { type: Boolean, default: false }
    },
    analysisDate: {
      type: Date,
      default: null
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Analysis notes must be less than 500 characters']
    },
    details: {
      framesAnalyzed: { type: Number, default: 0 },
      averageScores: {
        suspicion: { type: Number, default: 0 },
        brightness: { type: Number, default: 0 },
        contrast: { type: Number, default: 0 },
        highSuspicionFrames: { type: Number, default: 0 }
      },
      error: { type: String, default: null }
    }
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  visibility: {
    type: String,
    enum: ['private', 'organization', 'public'],
    default: 'private'
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: [50, 'Each tag must be less than 50 characters']
  }],
  metadata: {
    codec: String,
    bitrate: Number,
    frameRate: Number,
    aspectRatio: String
  },
  viewCount: {
    type: Number,
    default: 0
  },
  lastViewedAt: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

videoSchema.index({ uploadedBy: 1, organizationId: 1 });
videoSchema.index({ status: 1 });
videoSchema.index({ 'sensitivityAnalysis.status': 1 });
videoSchema.index({ 'sensitivityAnalysis.result': 1 });
videoSchema.index({ createdAt: -1 });
videoSchema.index({ title: 'text', description: 'text', tags: 'text' });

videoSchema.virtual('fileUrl').get(function() {
  return `/uploads/${this.filename}`;
});

videoSchema.virtual('thumbnailUrl').get(function() {
  return this.thumbnail ? `/uploads/thumbnails/${this.thumbnail}` : null;
});

videoSchema.methods.canBeViewedBy = function(user) {
  if (this.visibility === 'public') return true;
  if (this.visibility === 'organization' && this.organizationId.toString() === user.organizationId.toString()) return true;
  
  let uploadedById;
  if (this.uploadedBy && typeof this.uploadedBy === 'object' && this.uploadedBy._id) {
    uploadedById = this.uploadedBy._id.toString();
  } else {
    uploadedById = this.uploadedBy.toString();
  }
  
  if (this.visibility === 'private' && uploadedById === user._id.toString()) return true;
  
  return user.role === 'admin' && this.organizationId.toString() === user.organizationId.toString();
};

videoSchema.methods.updateProgress = function(progress, status = null) {
  this.processingProgress = Math.min(100, Math.max(0, progress));
  if (status) this.status = status;
  return this.save();
};

export default mongoose.model('Video', videoSchema);