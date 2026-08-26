"""Driver statistics endpoints."""
from datetime import datetime, timedelta

from aiohttp import web

from app.api.drivers import _get_driver_from_request, compute_online_seconds_today
from app.database import get_session
from app.models import Order
from app.services.rewards import effective_commission, passenger_payable
from app.utils.timefmt import local_day_start_utc, local_day_str


def _period_start(period: str) -> datetime:
    now = datetime.utcnow()
    if period == "today":
        # LOCAL midnight, not UTC midnight (= 05:00 Tashkent), so a ride at 01:00
        # local counts towards today rather than yesterday.
        return local_day_start_utc(now)
    if period == "week":
        return now - timedelta(days=7)
    if period == "month":
        return now - timedelta(days=30)
    return now - timedelta(days=365)


async def driver_stats(request: web.Request) -> web.Response:
    """GET /api/driver/stats?period=today|week|month
    Returns earnings, orders count, top routes for the driver.
    """
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)

    period = request.query.get("period", "today")
    start = _period_start(period)

    session = get_session()
    try:
        # Completed orders in period
        completed = (
            session.query(Order)
            .filter(
                Order.driver_id == driver.id,
                Order.status == "completed",
                Order.completed_at >= start,
            )
            .all()
        )

        cancelled_count = (
            session.query(Order)
            .filter(
                Order.driver_id == driver.id,
                Order.status == "cancelled",
                Order.cancelled_at >= start,
            )
            .count()
        )

        completed_count = len(completed)
        # Cash the driver actually collected: bonus and promo discounts are settled against
        # commission, not paid in cash, so neither counts as revenue.
        total_revenue = sum(passenger_payable(o) for o in completed)
        # Commission the driver actually paid, net of both discounts -- this is the same
        # figure the commission scheduler deducts from the balance.
        total_commission = sum(effective_commission(o) for o in completed)
        # Nets out to price - commission, matching the per-day `earnings` figure below.
        net_earnings = total_revenue - total_commission

        # Top routes
        route_counts = {}
        for o in completed:
            key = f"{o.from_city} → {o.to_city}"
            route_counts[key] = route_counts.get(key, 0) + 1
        top_routes = sorted(route_counts.items(), key=lambda x: -x[1])[:5]

        # Daily breakdown (for chart)
        daily = {}
        for o in completed:
            if o.completed_at:
                # Bucket on the LOCAL calendar day.
                day = local_day_str(o.completed_at)
                if day not in daily:
                    daily[day] = {"count": 0, "revenue": 0, "earnings": 0}
                daily[day]["count"] += 1
                # Same basis as the totals above: cash collected, then net of the
                # commission actually deducted.
                daily[day]["revenue"] += passenger_payable(o)
                daily[day]["earnings"] += passenger_payable(o) - effective_commission(o)

        daily_list = [
            {"date": k, **v}
            for k, v in sorted(daily.items())
        ]

        # Service type breakdown
        service_breakdown = {"taxi": 0, "parcel": 0, "full_car": 0}
        for o in completed:
            service_breakdown[o.service_type] = service_breakdown.get(o.service_type, 0) + 1

        return web.json_response({
            "period": period,
            "since": start.isoformat(),
            "completed_orders": completed_count,
            "cancelled_orders": cancelled_count,
            "total_revenue": total_revenue,
            "total_commission": total_commission,
            "net_earnings": net_earnings,
            "current_balance": driver.balance or 0,
            "rating": driver.rating or 5.0,
            "rating_count": driver.rating_count or 0,
            "online_seconds_today": compute_online_seconds_today(driver),
            "top_routes": [{"route": r, "count": c} for r, c in top_routes],
            "daily": daily_list,
            "service_breakdown": service_breakdown,
        })
    finally:
        session.close()
