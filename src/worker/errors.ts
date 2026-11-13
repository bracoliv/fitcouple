export class GameError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GameError";
    this.status = status;
  }
}
