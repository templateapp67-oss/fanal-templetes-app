export const PARTNER_MILESTONES = [
  { target: 25, reward: 'Official Nexora T-Shirt', icon: 'shirt' },
  { target: 50, reward: 'Samsung Tablet', icon: 'tablet' },
  { target: 100, reward: 'Branded HP Laptop', icon: 'laptop' },
  { target: 250, reward: 'Electric Scooter', icon: 'scooter' },
  { target: 500, reward: 'Latest iPhone', icon: 'phone' },
  { target: 750, reward: 'Royal Enfield 350 CC', icon: 'bike' },
  { target: 1000, reward: 'District Partner SUV Car', icon: 'car' },
] as const;

export function milestoneProgress(count: number | null | undefined, target: number) {
  const known = typeof count === 'number' && Number.isFinite(count) && count >= 0;
  const completed = known ? Math.floor(count) : null;
  return {
    completed,
    remaining: completed === null ? null : Math.max(0, target - completed),
    percent: completed === null ? 0 : Math.min(100, completed / target * 100),
    reached: completed !== null && completed >= target,
  };
}
