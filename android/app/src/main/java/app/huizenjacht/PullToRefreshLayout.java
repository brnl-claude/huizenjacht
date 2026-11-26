package app.huizenjacht;

import android.content.Context;
import android.view.MotionEvent;
import android.view.ViewConfiguration;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * Pull down at the top of the page to load it again. Unlike a plain SwipeRefreshLayout it
 * leaves sideways swipes to the page, even when they drift
 * down a little, and pinches with two fingers. A tap, or a finger that drifts down a bit while
 * tapping, never pulls: only a clear pull straight down starts one, and it has to go well down
 * the screen before the page loads again.
 */
final class PullToRefreshLayout extends SwipeRefreshLayout {
    private final int mTouchSlop;
    // How far a finger has to go down before it counts as a pull.
    private final int mPullSlop;
    private float mDownX;
    private float mDownY;
    private boolean mSideways;
    private boolean mPinch;
    private boolean mPulling;

    PullToRefreshLayout(Context context) {
        super(context);
        mTouchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        float density = context.getResources().getDisplayMetrics().density;
        mPullSlop = Math.max(mTouchSlop * 3, Math.round(32 * density));
        // The default (64dp) loads the page again after a short pull.
        setDistanceToTriggerSync(Math.round(160 * density));
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            mDownX = event.getX();
            mDownY = event.getY();
            mSideways = false;
            mPinch = false;
            mPulling = false;
        } else if (action == MotionEvent.ACTION_POINTER_DOWN) {
            mPinch = true;
        } else if (action == MotionEvent.ACTION_MOVE && !mSideways && !mPulling) {
            float dx = Math.abs(event.getX() - mDownX);
            float dy = event.getY() - mDownY;
            if (dx > mTouchSlop && dx > Math.abs(dy)) mSideways = true;
            else if (dy > mPullSlop && dy > 2 * dx) mPulling = true;
            // Not (yet) a clear pull down: leave the touch to the page.
            if (!mPulling) return false;
        }
        if (mSideways || mPinch || event.getPointerCount() > 1) return false;
        return super.onInterceptTouchEvent(event);
    }
}
