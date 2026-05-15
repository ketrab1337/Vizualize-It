-- Dodaje identyfikatory zadania po stronie dostawcy (OpenAI/Google AI Batch API).
ALTER TABLE batch_jobs ADD COLUMN provider_batch_id TEXT;
ALTER TABLE batch_jobs ADD COLUMN provider_input_file_id TEXT;
