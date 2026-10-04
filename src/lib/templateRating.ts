import type { SalonProfile } from '../types';

/** An aggregate is authoritative, including an explicit zero-review result. */
export function templateRating(profile: SalonProfile) {
  const aggregate = profile.publicRating;
  if (aggregate) {
    return Number.isFinite(aggregate.average) && aggregate.average >= 1 && aggregate.average <= 5 && Number.isInteger(aggregate.count) && aggregate.count > 0
      ? { average: aggregate.average, count: aggregate.count, label: 'customer reviews' }
      : null;
  }
  const reviews = (profile.testimonials ?? []).filter(review => Number.isFinite(review.rating) && review.rating >= 1 && review.rating <= 5);
  return reviews.length ? { average: reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length, count: reviews.length, label: 'salon testimonials' } : null;
}

export function templateRatingLabel(profile: SalonProfile) {
  const rating = templateRating(profile);
  return rating ? `${rating.average.toFixed(1)} (${rating.count} ${rating.label})` : 'No reviews yet';
}
