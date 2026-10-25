// Mirrors MuscleAnalysisResult in the backend (schemas/movement.py).
export interface Analysis {
  primary_muscles: string[];
  secondary_muscles: string[];
  myotomes: string;
  compensation: string;
  clinical_note: string;
  confidence: 'low' | 'medium' | 'high';
  limitations: string;
}
