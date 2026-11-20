export const PROGRAM_IDS = ["home", "beginner_gym", "fat_loss", "muscle"] as const;
export type ProgramId = (typeof PROGRAM_IDS)[number];

export function isProgramId(value: unknown): value is ProgramId {
  return value === "home" || value === "beginner_gym" || value === "fat_loss" || value === "muscle";
}

const TITLES: Record<ProgramId, string> = {
  home: "Home",
  beginner_gym: "Beginner gym",
  fat_loss: "Fat loss",
  muscle: "Muscle gain",
};

type Move = { name: string; videoKey: string | null };

const WEEKS: Record<ProgramId, Move[][]> = {
  home: [
    [{ name: "Chair squat", videoKey: "squat" }, { name: "Wall push-up", videoKey: "pushup" }, { name: "Easy walk", videoKey: null }],
    [{ name: "Squat", videoKey: "squat" }, { name: "Knee plank", videoKey: "plank" }, { name: "Easy walk", videoKey: null }],
    [{ name: "Squat", videoKey: "squat" }, { name: "Push-up", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Chair squat", videoKey: "squat" }, { name: "Wall push-up", videoKey: "pushup" }, { name: "Easy walk", videoKey: null }],
    [{ name: "Squat", videoKey: "squat" }, { name: "Push-up", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Easy walk", videoKey: null }, { name: "Squat", videoKey: "squat" }, { name: "Knee plank", videoKey: "plank" }],
    [{ name: "Easy walk", videoKey: null }, { name: "Stretch", videoKey: null }, { name: "Squat", videoKey: "squat" }],
  ],
  beginner_gym: [
    [{ name: "Goblet squat", videoKey: "squat" }, { name: "Machine or knee push-up", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Leg press or squat", videoKey: "barbell_squat" }, { name: "Chest press", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Squat", videoKey: "squat" }, { name: "Push-up", videoKey: "pushup" }, { name: "Easy walk", videoKey: null }],
    [{ name: "Goblet squat", videoKey: "squat" }, { name: "Row or band pull", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Squat", videoKey: "barbell_squat" }, { name: "Push-up", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Easy walk", videoKey: null }, { name: "Squat", videoKey: "squat" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Easy walk", videoKey: null }, { name: "Stretch", videoKey: null }, { name: "Chair squat", videoKey: "beginner_squat" }],
  ],
  fat_loss: [
    [{ name: "Brisk walk", videoKey: null }, { name: "Squat", videoKey: "squat" }, { name: "Push-up", videoKey: "pushup" }],
    [{ name: "Brisk walk", videoKey: null }, { name: "Squat", videoKey: "squat" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Easy walk", videoKey: null }, { name: "Wall push-up", videoKey: "pushup" }, { name: "Chair squat", videoKey: "beginner_squat" }],
    [{ name: "Brisk walk", videoKey: null }, { name: "Squat", videoKey: "squat" }, { name: "Push-up", videoKey: "pushup" }],
    [{ name: "Brisk walk", videoKey: null }, { name: "Plank", videoKey: "plank" }, { name: "Squat", videoKey: "squat" }],
    [{ name: "Longer easy walk", videoKey: null }, { name: "Squat", videoKey: "squat" }, { name: "Knee plank", videoKey: "plank" }],
    [{ name: "Easy walk", videoKey: null }, { name: "Stretch", videoKey: null }, { name: "Squat", videoKey: "squat" }],
  ],
  muscle: [
    [{ name: "Squat", videoKey: "barbell_squat" }, { name: "Push-up", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Squat", videoKey: "squat" }, { name: "Push-up", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Chair squat", videoKey: "beginner_squat" }, { name: "Wall push-up", videoKey: "pushup" }, { name: "Easy walk", videoKey: null }],
    [{ name: "Squat", videoKey: "barbell_squat" }, { name: "Push-up", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Squat", videoKey: "squat" }, { name: "Push-up", videoKey: "pushup" }, { name: "Plank", videoKey: "plank" }],
    [{ name: "Easy walk", videoKey: null }, { name: "Squat", videoKey: "squat" }, { name: "Knee plank", videoKey: "plank" }],
    [{ name: "Easy walk", videoKey: null }, { name: "Stretch", videoKey: null }, { name: "Chair squat", videoKey: "beginner_squat" }],
  ],
};

export function sessionFor(programId: string | null | undefined, day: number) {
  if (!isProgramId(programId)) return null;
  const safeDay = Math.min(66, Math.max(1, day));
  const week = Math.ceil(safeDay / 7);
  const moves = WEEKS[programId][(safeDay - 1) % 7];
  return {
    programId,
    programTitle: TITLES[programId],
    day: safeDay,
    title: `Week ${week} · ${TITLES[programId]}`,
    note: week >= 3 ? "Add one extra round if the last two weeks felt steady." : "Learn the shape. Stop if a joint hurts.",
    moves,
  };
}

export const PROGRAM_CHOICES = PROGRAM_IDS.map((id) => ({ id, title: TITLES[id] }));
