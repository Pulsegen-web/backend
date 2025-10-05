import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Organization name is required'],
    unique: true,
    trim: true,
    maxlength: [100, 'Organization name must be less than 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description must be less than 500 characters']
  },
  domain: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    match: [/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/, 'Please enter a valid domain']
  },
  settings: {
    maxVideoSize: {
      type: Number,
      default: 1024 * 1024 * 1024
    },
    maxVideosPerUser: {
      type: Number,
      default: 100
    },
    allowedVideoFormats: {
      type: [String],
      default: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm']
    },
    enableSensitivityAnalysis: {
      type: Boolean,
      default: true
    }
  },
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'basic', 'premium', 'enterprise'],
      default: 'free'
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    },
    features: {
      maxUsers: {
        type: Number,
        default: 5
      },
      storageLimit: {
        type: Number,
        default: 10 * 1024 * 1024 * 1024
      }
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  }
}, {
  timestamps: true
});

organizationSchema.index({ name: 1 });
organizationSchema.index({ domain: 1 });
organizationSchema.index({ isActive: 1 });

export default mongoose.model('Organization', organizationSchema);