package app.huizenjacht;

import android.content.Context;
import android.view.MotionEvent;
import android.view.ViewConfiguration;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * Pull down at the top of the page to load it again. Unlike a plain SwipeRefreshLayout it
 * leaves sideways swipes to the page, even when they drift
 * down a little.
 */
final class PullToRefreshLayout extends SwipeRefreshLayout {
    private final int mTouchSlop;
    private float mDownX;
    private float mDownY;
    private boolean mSideways;

    PullToRefreshLayout(Context context) {
        super(context);
        mTouchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            mDownX = event.getX();
            mDownY = event.getY();
            mSideways = false;
        } else if (action == MotionEvent.ACTION_MOVE && !mSideways) {
            float dx = Math.abs(event.getX() - mDownX);
            float dy = Math.abs(event.getY() - mDownY);
            if (dx > mTouchSlop && dx > dy) mSideways = true;
        }
        if (mSideways) return false;
        return super.onInterceptTouchEvent(event);
    }
}
