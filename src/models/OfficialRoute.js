const mongoose = require('mongoose');

const waypointSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
    elevation: { type: Number, default: 0 },
    name: { type: String, default: '' },
  },
  { _id: false }
);

const officialRouteSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: '', trim: true },
    cover_image: { type: String, default: '' },
    difficulty: {
      type: String,
      enum: ['Easy', 'Moderate', 'Hard'],
      default: 'Moderate',
    },
    distance_km: { type: Number, required: true, min: 0 },
    duration_hours: { type: Number, required: true, min: 0 },
    elevation_gain: { type: Number, default: 0, min: 0 },
    gpx_data: { type: String, default: '' },
    waypoints: {
      type: [waypointSchema],
      default: [],
    },
    description: { type: String, default: '' },
    equipment_tips: { type: String, default: '' },
    tags: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

officialRouteSchema.index({ difficulty: 1 });
officialRouteSchema.index({ tags: 1 });

const OfficialRoute =
  mongoose.models.OfficialRoute || mongoose.model('OfficialRoute', officialRouteSchema);
module.exports = OfficialRoute;
