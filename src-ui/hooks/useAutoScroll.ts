import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEventHandler,
  type RefCallback,
} from "react";

interface AutoScrollState {
  scrollRef: RefCallback<HTMLDivElement>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
  handleScroll: UIEventHandler<HTMLDivElement>;
}

function isNearBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 40;
}

export function useAutoScroll(deps: unknown[]): AutoScrollState {
  const ref = useRef<HTMLDivElement | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const syncScrollState = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;

    const next = isNearBottom(element);
    stickRef.current = next;
    setIsAtBottom(next);
  }, []);

  useEffect(() => {
    if (!element) return;

    syncScrollState(element);
    const frame = window.requestAnimationFrame(() => {
      syncScrollState(ref.current);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [element, syncScrollState]);

  useEffect(() => {
    if (!element) return;

    if (stickRef.current) {
      element.scrollTop = element.scrollHeight;
      stickRef.current = true;
      setIsAtBottom(true);
      return;
    }

    syncScrollState(element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, ...deps]);

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    syncScrollState(event.currentTarget);
  }, [syncScrollState]);

  const scrollToBottom = () => {
    if (!ref.current) return;

    stickRef.current = true;
    setIsAtBottom(true);
    ref.current.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  };

  const scrollRef = useMemo<RefCallback<HTMLDivElement>>(
    () => (node) => {
      ref.current = node;
      setElement(node);
      if (node) {
        syncScrollState(node);
      }
    },
    [syncScrollState],
  );

  return {
    scrollRef,
    isAtBottom,
    scrollToBottom,
    handleScroll,
  };
}
