"""Admin panel web interface for Sarix Go."""
from app.admin.api import setup_api_routes
from app.admin.routes import setup_page_routes


def setup_admin_routes(app):
    """Register all admin panel routes on the aiohttp app."""
    setup_page_routes(app)
    setup_api_routes(app)
