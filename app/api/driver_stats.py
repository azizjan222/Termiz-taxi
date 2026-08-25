"""Driver statistics endpoints."""
from datetime import datetime, timedelta

from aiohttp import web

from app.api.drivers import _get_driver_from_request, compute_online_seconds_today
from app.database import get_session
from app.models import Order


def _period_start(period: str) -> datetime:
    now = datetime.utcnow()
    if period == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
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
        # Cash the driver actually collected from passengers: the bonus discount is paid
        # from the passenger's bonus wallet, not in cash, so it is not revenue.
        total_revenue = sum(max(0, (o.price or 0) - (o.bonus_used or 0)) for o in completed)
        # Commission the driver actually paid is net of any bonus discount on the ride
        # (the bonus portion is waived / refunded, so it never reduces the driver's net).
        total_commission = sum(max(0, (o.commission or 0) - (o.bonus_used or 0)) for o in completed)
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
                day = o.completed_at.strftime("%Y-%m-%d")
                if day not in daily:
                    daily[day] = {"count": 0, "revenue": 0, "earnings": 0}
                daily[day]["count"] += 1
                # Same basis as the totals above: cash collected, then net of the
                # commission actually deducted.
                daily[day]["revenue"] += max(0, (o.price or 0) - (o.bonus_used or 0))
                daily[day]["earnings"] += max(0, (o.price or 0) - (o.bonus_used or 0)) - max(
                    0, (o.commission or 0) - (o.bonus_used or 0)
                )

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
