import React, { useEffect, useMemo, useState } from 'react';
import {
  getFavFolders,
  getFavList,
  getMySubscriptions,
  getSubscriptionVideos,
} from '../api/client';
import FocusableTab from '../components/FocusableTab';
import SubscriptionList from '../components/SubscriptionList';
import VideoGrid from '../components/VideoGrid';
import {
  getCurrentFocusId,
  onFocusChange,
  setCustomKeyHandler,
  setFocus,
} from '../hooks/useFocus';
import { storage } from '../utils/storage';

const FAVORITES_MODE = 'favorites';
const SUBSCRIPTIONS_MODE = 'subscriptions';
const SUBSCRIPTION_LIST_VIEW = 'list';
const SUBSCRIPTION_DETAIL_VIEW = 'detail';
const SUBSCRIPTIONS_PAGE_SIZE = 50;
const SUBSCRIPTION_DETAIL_PAGE_SIZE = 30;

function getSubscriptionFocusId(index, cols) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return `subscription-${row}-${col}`;
}

function parseSubscriptionFocusId(focusId) {
  const match = /^subscription-(\d+)-(\d+)$/.exec(focusId || '');
  if (!match) return null;
  return {
    row: Number(match[1]),
    col: Number(match[2]),
  };
}

function mapFavoriteVideo(item) {
  return {
    bvid: item.bvid,
    title: item.title,
    pic: item.cover,
    duration: item.duration,
    owner: { name: item.upper?.name },
    stat: { view: item.cnt_info?.play },
  };
}

export default function FavoritesPage({ userMid, onPlayVideo }) {
  const [mode, setMode] = useState(FAVORITES_MODE);
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [favoriteVideos, setFavoriteVideos] = useState([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesError, setFavoritesError] = useState('');

  const [subscriptionView, setSubscriptionView] = useState(
    SUBSCRIPTION_LIST_VIEW,
  );
  const [subscriptions, setSubscriptions] = useState([]);
  const [subscriptionsPage, setSubscriptionsPage] = useState({
    pageNum: 1,
    pageSize: SUBSCRIPTIONS_PAGE_SIZE,
    total: 0,
  });
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [subscriptionsError, setSubscriptionsError] = useState('');
  const [subscriptionsLoaded, setSubscriptionsLoaded] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState(null);
  const [subscriptionVideos, setSubscriptionVideos] = useState([]);
  const [subscriptionVideosPage, setSubscriptionVideosPage] = useState({
    pageNum: 1,
    pageSize: SUBSCRIPTION_DETAIL_PAGE_SIZE,
    total: 0,
  });
  const [subscriptionVideosLoading, setSubscriptionVideosLoading] =
    useState(false);
  const [lastFocusedSubscriptionId, setLastFocusedSubscriptionId] =
    useState(null);
  const [shouldRestoreSubscriptionFocus, setShouldRestoreSubscriptionFocus] =
    useState(false);
  const [subscriptionDetailCache, setSubscriptionDetailCache] = useState({});
  const [gridCols] = useState(() => storage.getSettings().videoGridCols || 3);

  const selectedFolderIndex = folders.findIndex(
    (folder) => folder.id === selectedFolderId,
  );

  const isFavoritesMode = mode === FAVORITES_MODE;
  const isSubscriptionsMode = mode === SUBSCRIPTIONS_MODE;
  const isSubscriptionDetail =
    isSubscriptionsMode && subscriptionView === SUBSCRIPTION_DETAIL_VIEW;
  const hasFavoriteFolders = folders.length > 0;
  const isFavoriteFoldersLoading = favoritesLoading && !hasFavoriteFolders;
  const isFavoriteVideosLoading = favoritesLoading && hasFavoriteFolders;

  const pageTitle = useMemo(() => {
    if (isSubscriptionDetail && selectedSubscription?.title) {
      return `我的订阅 / ${selectedSubscription.title}`;
    }
    return '我的收藏';
  }, [isSubscriptionDetail, selectedSubscription]);

  useEffect(() => {
    if (!userMid) {
      setFolders([]);
      setSelectedFolderId(null);
      setFavoriteVideos([]);
      setFavoritesError('');
      setFavoritesLoading(false);
      setSubscriptions([]);
      setSubscriptionsLoaded(false);
      setSubscriptionsError('');
      setSelectedSubscription(null);
      setSubscriptionVideos([]);
      setSubscriptionView(SUBSCRIPTION_LIST_VIEW);
      return;
    }

    let cancelled = false;

    async function loadFolders() {
      setFavoritesLoading(true);
      setFavoritesError('');
      try {
        const res = await getFavFolders(userMid);
        if (cancelled) return;
        const nextFolders = res?.data?.list || [];
        setFolders(nextFolders);
        if (nextFolders.length === 0) {
          setSelectedFolderId(null);
          setFavoriteVideos([]);
          setFavoritesError('暂无收藏夹');
          return;
        }
        setSelectedFolderId((current) =>
          nextFolders.some((folder) => folder.id === current)
            ? current
            : nextFolders[0].id,
        );
      } catch (err) {
        if (!cancelled) {
          console.error('Fav folders error:', err);
          setFolders([]);
          setSelectedFolderId(null);
          setFavoriteVideos([]);
          setFavoritesError(err.message || '加载失败');
        }
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }
    }

    loadFolders();

    return () => {
      cancelled = true;
    };
  }, [userMid]);

  useEffect(() => {
    if (!userMid || !selectedFolderId) return;

    let cancelled = false;

    async function loadFavoriteVideos() {
      setFavoritesLoading(true);
      setFavoritesError('');
      try {
        const favRes = await getFavList(selectedFolderId, 1, 24);
        if (cancelled) return;
        setFavoriteVideos((favRes?.data?.medias || []).map(mapFavoriteVideo));
      } catch (err) {
        if (!cancelled) {
          console.error('Fav videos error:', err);
          setFavoriteVideos([]);
          setFavoritesError(err.message || '加载失败');
        }
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }
    }

    loadFavoriteVideos();

    return () => {
      cancelled = true;
    };
  }, [selectedFolderId, userMid]);

  useEffect(() => {
    if (!userMid || !isSubscriptionsMode || subscriptionsLoaded) return;

    let cancelled = false;

    async function loadSubscriptions() {
      setSubscriptionsLoading(true);
      setSubscriptionsError('');
      try {
        const res = await getMySubscriptions(
          userMid,
          1,
          SUBSCRIPTIONS_PAGE_SIZE,
        );
        if (cancelled) return;
        setSubscriptions(res.items || []);
        setSubscriptionsPage(
          res.page || {
            pageNum: 1,
            pageSize: SUBSCRIPTIONS_PAGE_SIZE,
            total: 0,
          },
        );
        setSubscriptionsLoaded(true);
      } catch (err) {
        if (!cancelled) {
          console.error('Subscriptions error:', err);
          setSubscriptions([]);
          setSubscriptionsError(err.message || '加载失败');
        }
      } finally {
        if (!cancelled) setSubscriptionsLoading(false);
      }
    }

    loadSubscriptions();

    return () => {
      cancelled = true;
    };
  }, [isSubscriptionsMode, subscriptionsLoaded, userMid]);

  useEffect(() => {
    if (!isSubscriptionDetail || !selectedSubscription) return;

    const cacheKey = selectedSubscription.id;
    const cached = subscriptionDetailCache[cacheKey];
    if (cached) {
      setSubscriptionVideos(cached.items);
      setSubscriptionVideosPage(cached.page);
      setSubscriptionsError('');
      setSubscriptionVideosLoading(false);
      return;
    }

    let cancelled = false;

    async function loadSubscriptionDetail() {
      setSubscriptionVideosLoading(true);
      setSubscriptionsError('');
      try {
        const res = await getSubscriptionVideos({
          seasonId:
            selectedSubscription.seasonId || selectedSubscription.mediaId,
          pageNum: 1,
          pageSize: SUBSCRIPTION_DETAIL_PAGE_SIZE,
        });
        if (cancelled) return;
        setSubscriptionVideos(res.items || []);
        setSubscriptionVideosPage(
          res.page || {
            pageNum: 1,
            pageSize: SUBSCRIPTION_DETAIL_PAGE_SIZE,
            total: 0,
          },
        );
        setSubscriptionDetailCache((current) => ({
          ...current,
          [cacheKey]: {
            items: res.items || [],
            page: res.page || {
              pageNum: 1,
              pageSize: SUBSCRIPTION_DETAIL_PAGE_SIZE,
              total: 0,
            },
          },
        }));
      } catch (err) {
        if (!cancelled) {
          console.error('Subscription detail error:', err);
          setSubscriptionVideos([]);
          setSubscriptionsError(err.message || '加载失败');
        }
      } finally {
        if (!cancelled) setSubscriptionVideosLoading(false);
      }
    }

    loadSubscriptionDetail();

    return () => {
      cancelled = true;
    };
  }, [isSubscriptionDetail, selectedSubscription, subscriptionDetailCache]);

  useEffect(() => {
    if (isFavoritesMode && !favoritesLoading && favoriteVideos.length > 0) {
      setFocus('content-2-0');
      return;
    }

    if (
      isSubscriptionDetail &&
      !subscriptionVideosLoading &&
      subscriptionVideos.length > 0 &&
      !subscriptionsError
    ) {
      setFocus('content-1-0');
    }
  }, [
    favoriteVideos.length,
    favoritesLoading,
    isFavoritesMode,
    isSubscriptionDetail,
    subscriptionVideos.length,
    subscriptionVideosLoading,
    subscriptionsError,
  ]);

  useEffect(() => {
    if (
      !shouldRestoreSubscriptionFocus ||
      !isSubscriptionsMode ||
      subscriptionView !== SUBSCRIPTION_LIST_VIEW
    ) {
      return;
    }

    const nextFocusId =
      lastFocusedSubscriptionId &&
      subscriptions.some(
        (_, index) =>
          getSubscriptionFocusId(index, gridCols) === lastFocusedSubscriptionId,
      )
        ? lastFocusedSubscriptionId
        : subscriptions.length > 0
          ? getSubscriptionFocusId(0, gridCols)
          : 'content-0-1';

    setFocus(nextFocusId);
    setShouldRestoreSubscriptionFocus(false);
  }, [
    isSubscriptionsMode,
    lastFocusedSubscriptionId,
    shouldRestoreSubscriptionFocus,
    subscriptionView,
    subscriptions,
  ]);

  useEffect(() => {
    async function loadMoreSubscriptions() {
      if (
        subscriptionsLoading ||
        !userMid ||
        subscriptions.length >= subscriptionsPage.total
      ) {
        return;
      }

      setSubscriptionsLoading(true);
      try {
        const nextPage = (subscriptionsPage.pageNum || 1) + 1;
        const res = await getMySubscriptions(
          userMid,
          nextPage,
          SUBSCRIPTIONS_PAGE_SIZE,
        );
        setSubscriptions((current) => {
          const seen = new Set(current.map((item) => item.id));
          return current.concat(
            (res.items || []).filter((item) => !seen.has(item.id)),
          );
        });
        setSubscriptionsPage(
          res.page || {
            pageNum: nextPage,
            pageSize: SUBSCRIPTIONS_PAGE_SIZE,
            total: subscriptionsPage.total,
          },
        );
      } catch (err) {
        console.error('Subscriptions pagination error:', err);
      } finally {
        setSubscriptionsLoading(false);
      }
    }

    async function loadMoreSubscriptionVideos() {
      if (
        subscriptionVideosLoading ||
        !selectedSubscription ||
        subscriptionVideos.length >= subscriptionVideosPage.total
      ) {
        return;
      }

      setSubscriptionVideosLoading(true);
      try {
        const nextPage = (subscriptionVideosPage.pageNum || 1) + 1;
        const res = await getSubscriptionVideos({
          seasonId:
            selectedSubscription.seasonId || selectedSubscription.mediaId,
          pageNum: nextPage,
          pageSize: SUBSCRIPTION_DETAIL_PAGE_SIZE,
        });
        setSubscriptionVideos((current) => {
          const seen = new Set(
            current.map((item) => `${item.bvid}-${item.cid}`),
          );
          const merged = current.concat(
            (res.items || []).filter(
              (item) => !seen.has(`${item.bvid}-${item.cid}`),
            ),
          );
          setSubscriptionDetailCache((cache) => ({
            ...cache,
            [selectedSubscription.id]: {
              items: merged,
              page: res.page || {
                pageNum: nextPage,
                pageSize: SUBSCRIPTION_DETAIL_PAGE_SIZE,
                total: subscriptionVideosPage.total,
              },
            },
          }));
          return merged;
        });
        setSubscriptionVideosPage(
          res.page || {
            pageNum: nextPage,
            pageSize: SUBSCRIPTION_DETAIL_PAGE_SIZE,
            total: subscriptionVideosPage.total,
          },
        );
      } catch (err) {
        console.error('Subscription detail pagination error:', err);
      } finally {
        setSubscriptionVideosLoading(false);
      }
    }

    return onFocusChange((focusId) => {
      if (mode !== SUBSCRIPTIONS_MODE) return;

      if (
        subscriptionView === SUBSCRIPTION_LIST_VIEW &&
        focusId?.startsWith('subscription-')
      ) {
        const coords = parseSubscriptionFocusId(focusId);
        const index = coords ? coords.row * gridCols + coords.col : -1;
        if (
          index >= subscriptions.length - gridCols &&
          subscriptions.length < subscriptionsPage.total
        ) {
          loadMoreSubscriptions();
        }
      }

      if (
        subscriptionView === SUBSCRIPTION_DETAIL_VIEW &&
        focusId?.startsWith('content-')
      ) {
        const row = Number(focusId.split('-')[1] || 0);
        const totalRows = Math.ceil(subscriptionVideos.length / gridCols);
        if (
          row >= totalRows - 2 &&
          subscriptionVideos.length < subscriptionVideosPage.total
        ) {
          loadMoreSubscriptionVideos();
        }
      }
    });
  }, [
    gridCols,
    mode,
    selectedSubscription,
    subscriptionVideos.length,
    subscriptionVideosLoading,
    subscriptionVideosPage,
    subscriptionView,
    subscriptions.length,
    subscriptionsLoading,
    subscriptionsPage,
    userMid,
  ]);

  useEffect(() => {
    function handleModeSelect(nextMode) {
      setMode(nextMode);
      if (nextMode === SUBSCRIPTIONS_MODE) {
        setSubscriptionView(SUBSCRIPTION_LIST_VIEW);
      }
    }

    function handleKey(event) {
      const focusId = getCurrentFocusId();

      if (
        (event.keyCode === 461 ||
          event.key === 'Backspace' ||
          event.key === 'GoBack') &&
        isSubscriptionsMode &&
        subscriptionView === SUBSCRIPTION_DETAIL_VIEW
      ) {
        event.preventDefault();
        event.stopPropagation();
        setSubscriptionView(SUBSCRIPTION_LIST_VIEW);
        setShouldRestoreSubscriptionFocus(true);
        return true;
      }

      if (event.key === 'ArrowDown') {
        if (focusId === 'content-0-0' && folders.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          setFocus(`content-1-${Math.max(0, selectedFolderIndex)}`);
          return true;
        }
        if (focusId === 'content-0-1') {
          event.preventDefault();
          event.stopPropagation();
          if (subscriptionView === SUBSCRIPTION_LIST_VIEW) {
            setShouldRestoreSubscriptionFocus(true);
          } else if (subscriptionVideos.length > 0) {
            setFocus('content-1-0');
          }
          return true;
        }
      }

      if (event.key === 'ArrowUp') {
        if (focusId?.startsWith('subscription-')) {
          const coords = parseSubscriptionFocusId(focusId);
          if (coords?.row === 0) {
            event.preventDefault();
            event.stopPropagation();
            setFocus('content-0-1');
            return true;
          }
        }
        if (focusId?.startsWith('content-2-')) {
          event.preventDefault();
          event.stopPropagation();
          setFocus(`content-1-${Math.max(0, selectedFolderIndex)}`);
          return true;
        }
        if (focusId?.startsWith('content-1-') && isSubscriptionDetail) {
          event.preventDefault();
          event.stopPropagation();
          setFocus('content-0-1');
          return true;
        }
        if (focusId?.startsWith('content-1-') && isFavoritesMode) {
          event.preventDefault();
          event.stopPropagation();
          setFocus('content-0-0');
          return true;
        }
      }

      if (
        event.key === 'Enter' &&
        (focusId === 'content-0-0' || focusId === 'content-0-1')
      ) {
        handleModeSelect(
          focusId === 'content-0-0' ? FAVORITES_MODE : SUBSCRIPTIONS_MODE,
        );
      }

      return false;
    }

    setCustomKeyHandler(handleKey);
    return () => setCustomKeyHandler(null);
  }, [
    folders.length,
    isFavoritesMode,
    isSubscriptionsMode,
    lastFocusedSubscriptionId,
    selectedFolderIndex,
    subscriptionVideos.length,
    subscriptionView,
    subscriptions,
  ]);

  function handleSubscriptionSelect(item, index, focusId) {
    setSelectedSubscription(item);
    setLastFocusedSubscriptionId(
      focusId || getSubscriptionFocusId(index, gridCols),
    );
    setSubscriptionView(SUBSCRIPTION_DETAIL_VIEW);
  }

  function renderFavoritesContent() {
    if (isFavoriteFoldersLoading) {
      return (
        <div className="loading">
          <div className="loading-spinner" />
          加载中...
        </div>
      );
    }

    if (favoritesError) {
      return <div className="empty-state">{favoritesError}</div>;
    }

    return (
      <>
        {hasFavoriteFolders ? (
          <div className="tabs tabs-secondary">
            {folders.map((folder, index) => (
              <FocusableTab
                key={folder.id}
                id={`content-1-${index}`}
                row={1}
                col={index}
                group="content"
                label={folder.title || folder.name || `收藏夹 ${index + 1}`}
                active={folder.id === selectedFolderId}
                variant="secondary"
                onSelect={() => setSelectedFolderId(folder.id)}
              />
            ))}
          </div>
        ) : null}
        {isFavoriteVideosLoading ? (
          <div className="loading">
            <div className="loading-spinner" />
            加载中...
          </div>
        ) : (
          <VideoGrid
            videos={favoriteVideos}
            group="content"
            startRow={2}
            cols={gridCols}
            onSelect={onPlayVideo}
          />
        )}
      </>
    );
  }

  function renderSubscriptionsContent() {
    if (subscriptionView === SUBSCRIPTION_DETAIL_VIEW) {
      if (subscriptionVideosLoading && subscriptionVideos.length === 0) {
        return (
          <div className="loading">
            <div className="loading-spinner" />
            加载中...
          </div>
        );
      }

      if (subscriptionsError) {
        return <div className="empty-state">{subscriptionsError}</div>;
      }

      return (
        <VideoGrid
          videos={subscriptionVideos}
          group="content"
          startRow={1}
          cols={gridCols}
          onSelect={onPlayVideo}
        />
      );
    }

    if (subscriptionsLoading && subscriptions.length === 0) {
      return (
        <div className="loading">
          <div className="loading-spinner" />
          加载中...
        </div>
      );
    }

    if (subscriptionsError) {
      return <div className="empty-state">{subscriptionsError}</div>;
    }

    return (
      <SubscriptionList
        items={subscriptions}
        cols={gridCols}
        onSelect={handleSubscriptionSelect}
      />
    );
  }

  if (!userMid) {
    return (
      <div>
        <div className="page-title">我的收藏</div>
        <div className="empty-state">请先登录</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-title">{pageTitle}</div>
      <div className="tabs tabs-primary">
        <FocusableTab
          id="content-0-0"
          row={0}
          col={0}
          group="content"
          label="收藏夹"
          active={isFavoritesMode}
          variant="primary"
          onSelect={() => {
            setMode(FAVORITES_MODE);
            setSubscriptionView(SUBSCRIPTION_LIST_VIEW);
          }}
        />
        <FocusableTab
          id="content-0-1"
          row={0}
          col={1}
          group="content"
          label="我的订阅"
          active={isSubscriptionsMode}
          variant="primary"
          onSelect={() => {
            setMode(SUBSCRIPTIONS_MODE);
            setSubscriptionView(SUBSCRIPTION_LIST_VIEW);
          }}
        />
      </div>
      {isFavoritesMode
        ? renderFavoritesContent()
        : renderSubscriptionsContent()}
    </div>
  );
}
