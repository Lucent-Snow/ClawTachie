import { useEffect } from "react";
import { TACHIE_SET, type TachieName } from "../lib/emotions";
import { useCharacter } from "../stores/character";
import styles from "./CharacterSprite.module.css";

interface CharacterSpriteProps {
  tachie: TachieName;
  alt?: string;
}

export function CharacterSprite({
  tachie,
  alt = "character sprite",
}: CharacterSpriteProps) {
  const sprites = useCharacter((state) => state.sprites);
  const ready = useCharacter((state) => state.ready);
  const load = useCharacter((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const activeEmotion = sprites[tachie] ? tachie : "normal";
  const hasSprites = Object.keys(sprites).length > 0;

  if (ready && !hasSprites) {
    return <div className={styles.placeholder}>No Sprite</div>;
  }

  return (
    <div className={styles.container}>
      {TACHIE_SET.map((name) => {
        const src = sprites[name];
        if (!src) {
          return null;
        }

        return (
          <img
            key={name}
            src={src}
            alt={alt}
            className={`${styles.sprite} ${name === activeEmotion ? styles.active : ""}`}
            draggable={false}
          />
        );
      })}
    </div>
  );
}
