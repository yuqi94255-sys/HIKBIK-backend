const mongoose = require('mongoose');

const waypointSchema = new mongoose.Schema(
  {
    lat: { type: String, required: true },
    lon: { type: String, required: true },
    elevation: { type: Number, required: true },
    timestamp: { type: Number, required: true },
  },
  { _id: false }
);

const routeSchema = new mongoose.Schema(
  {
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    waypoints: {
      type: [waypointSchema],
      required: true,
      default: [],
    },
    location: {
      type: {
        type: String,
        enum: ['LineString'],
        default: 'LineString',
      },
      coordinates: {
        type: [[Number]],
        default: [],
      },
    },
    stats: {
      totalDistance: { type: Number, default: 0 },
      totalAscent: { type: Number, default: 0 },
      avgSpeed: { type: Number, default: 0 },
    },
    likeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

routeSchema.index({ location: '2dsphere' });

routeSchema.pre('save', function (next) {
  if (this.waypoints && this.waypoints.length > 0) {
    this.location = {
      type: 'LineString',
      coordinates: this.waypoints.map((w) => [
        Number(w.lon),
        Number(w.lat),
      ]),
    };
  }
  next();
});

const Route = mongoose.models.Route || mongoose.model('Route', routeSchema);
module.exports = Route;
