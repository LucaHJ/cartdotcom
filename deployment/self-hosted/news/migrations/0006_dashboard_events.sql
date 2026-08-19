BEGIN;

CREATE OR REPLACE FUNCTION notify_dashboard_source_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('dashboard_events', json_build_object(
    'type', 'source_check_completed',
    'at', NEW.checked_at,
    'acquired_count', NEW.acquired_count,
    'source_count', NEW.source_count,
    'failed_source_count', NEW.failed_source_count
  )::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_checks_dashboard_event ON source_checks;
CREATE TRIGGER source_checks_dashboard_event
AFTER INSERT ON source_checks
FOR EACH ROW EXECUTE FUNCTION notify_dashboard_source_check();

CREATE OR REPLACE FUNCTION notify_dashboard_research_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('dashboard_events', json_build_object(
    'type', 'synthesis_completed',
    'at', NEW.created_at,
    'article_id', NEW.article_id,
    'result_id', NEW.id
  )::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS research_results_dashboard_event ON research_results;
CREATE TRIGGER research_results_dashboard_event
AFTER INSERT ON research_results
FOR EACH ROW EXECUTE FUNCTION notify_dashboard_research_result();

CREATE OR REPLACE FUNCTION notify_dashboard_job_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM pg_notify('dashboard_events', json_build_object(
      'type', 'job_status_changed',
      'at', CURRENT_TIMESTAMP,
      'job_id', NEW.id,
      'status', NEW.status
    )::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS research_jobs_dashboard_event ON research_jobs;
CREATE TRIGGER research_jobs_dashboard_event
AFTER UPDATE OF status ON research_jobs
FOR EACH ROW EXECUTE FUNCTION notify_dashboard_job_change();

COMMIT;
