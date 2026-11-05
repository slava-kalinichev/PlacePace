// Обёртка над Preview для просмотра маршрута в On It
import Preview from '../components/Preview';
import type { RouteCard, GuestRoute } from '../api/client';
import { ONIT_MODAL_Z } from './onitLayout';

interface OnItRouteViewProps {
  route: RouteCard;
  isLoggedIn: boolean;
  onClose: () => void;
  onWalk: () => void;
}

const NOOP = () => {};

const OnItRouteView = ({ route, isLoggedIn, onClose, onWalk }: OnItRouteViewProps) => {
  // В On It гостевых маршрутов нет
  const guestRoutes: GuestRoute[] = [];

  return (
    <Preview
      route={route}
      guestRoutes={guestRoutes}
      isLoggedIn={isLoggedIn}
      onClose={onClose}
      onRouteDeleted={onClose}
      onRouteUpdated={NOOP}
      onAdapt={NOOP}
      hideAdaptButtons
      mode="onit-view"
      onWalk={onWalk}
      zIndex={ONIT_MODAL_Z}
      offsetX={0}
      offsetY={0}
      isTop
      depth={0}
      isFullscreen
      onToggleFullscreen={NOOP}
      onSearchByCreator={NOOP}
      onCancelSearchByCreator={NOOP}
      onDeleteBounced={onClose}
      onDeleteCanceled={NOOP}
    />
  );
};

export default OnItRouteView;
