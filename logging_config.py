import logging
import os
import sys

_VALID_LOG_LEVELS = {
    name: level
    for name, level in logging.getLevelNamesMapping().items()
    if name and name.isalpha()
}


class ServiceFilter(logging.Filter):
    def __init__(self, service_name: str):
        super().__init__()
        self.service_name = service_name

    def filter(self, record: logging.LogRecord) -> bool:
        record.service = self.service_name
        return True


def configure_logging(service_name: str = "training-web") -> None:
    """Configure a single stdout handler for the current Python process."""
    resolved_name = (service_name or "training-web").strip() or "training-web"
    level_name = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    level = _VALID_LOG_LEVELS.get(level_name, logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    for handler in list(root_logger.handlers):
        if getattr(handler, "_training_web_handler", False):
            root_logger.removeHandler(handler)
            try:
                handler.close()
            except Exception:
                pass

    handler = logging.StreamHandler(sys.stdout)
    handler._training_web_handler = True
    handler.setLevel(level)
    handler.addFilter(ServiceFilter(resolved_name))
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(service)s %(name)s: %(message)s"
        )
    )
    root_logger.addHandler(handler)
