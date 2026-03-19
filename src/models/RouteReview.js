const mongoose = require('mongoose');

const routeReviewSchema = new mongoose.Schema(
  {
    routeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Route',
      required: true,
    },
    rating: { type: Number, required: true },
    comment: { type: String, default: '' },
    author: { type: String, required: true },
    date: { type: Date, default: Date.now },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

const RouteReview =
  mongoose.models.RouteReview ||
  mongoose.model('RouteReview', routeReviewSchema);
module.exports = RouteReview;
