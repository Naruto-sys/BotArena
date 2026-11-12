namespace BotArena;

internal readonly record struct Hitbox(Vec2 Center, double Angle, double Length, double Width)
{
    private Vec2 Forward => Vec2.FromAngle(Angle);
    private Vec2 Side => new(-Forward.Y, Forward.X);

    public double Extent(Vec2 axis) =>
        Length * 0.5 * Math.Abs(Forward.Dot(axis)) + Width * 0.5 * Math.Abs(Side.Dot(axis));

    public Bounds Bounds()
    {
        var x = Extent(new(1, 0));
        var y = Extent(new(0, 1));
        return new(Center.X - x, Center.Y - y, Center.X + x, Center.Y + y);
    }

    public double DistanceSquaredTo(Vec2 point)
    {
        var offset = point - Center;
        var x = Math.Max(0, Math.Abs(offset.Dot(Forward)) - Length * 0.5);
        var y = Math.Max(0, Math.Abs(offset.Dot(Side)) - Width * 0.5);
        return x * x + y * y;
    }

    // Swept separating-axis test. Both boxes keep their orientation throughout the segment.
    public double Impact(Hitbox target, Vec2 relativeMotion)
    {
        var moving = this;
        var separation = Center - target.Center;
        var enter = 0.0;
        var exit = 1.0;
        return Clip(Forward) && Clip(Side) && Clip(target.Forward) && Clip(target.Side)
            ? enter
            : double.PositiveInfinity;

        bool Clip(Vec2 axis)
        {
            var position = separation.Dot(axis);
            var motion = relativeMotion.Dot(axis);
            var extent = moving.Extent(axis) + target.Extent(axis);
            if (motion == 0) return Math.Abs(position) <= extent;
            var near = (-extent - position) / motion;
            var far = (extent - position) / motion;
            enter = Math.Max(enter, Math.Min(near, far));
            exit = Math.Min(exit, Math.Max(near, far));
            return enter <= exit;
        }
    }
}
