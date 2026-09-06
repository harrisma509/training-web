import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from services.yearly_service import calculate_year


def main():
    calendar_year = datetime.now(ZoneInfo("America/Denver")).year

    try:
        result = calculate_year(calendar_year)
    except Exception as exc:
        print(
            f"Yearly refresh failed for {calendar_year}: {type(exc).__name__}",
            file=sys.stderr,
        )
        return 1

    run_id = result.get("training_year_run_id")
    print(f"Yearly refresh {calendar_year}: {result.get('status', 'completed')} (run_id={run_id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
