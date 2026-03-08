export interface AppliedDiffMarker {
  id: string;
  start: number;
  end: number;
  oldText: string;
  newText?: string;
  reason: string;
}
