// 共有されたときの見え方（OGP・description）の設定。
//
// og:image と og:url は**絶対 URL** でないと読まれないので、サイトの基点を持つ。
// 本番は team301.jp だが、コードにドメインを埋めず SITE_ORIGIN で差し替えられるようにする
// （手元で確かめるときや、公開先が変わったときのため）。

/** サイトの基点。末尾のスラッシュは落とす */
export const SITE_ORIGIN = (process.env.SITE_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");

/** 相対パスを絶対 URL にする */
export function absoluteUrl(path = "/") {
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

// 共有されたときの文面。画面の見出し（h1・h2）とそろえ、検索されそうな言葉
// （横浜国大・横浜駅）を先に置く。「ODPT」は内部向けなので外した
export const SITE_META = {
  hamakokuex: {
    title: "横浜国大から横浜駅へ｜はまこく Exp.",
    description:
      "横浜国立大学の各地点から横浜駅までの最速ルートを、バス・電車・シェアサイクル・徒歩を組み合わせて検索できます。公共交通オープンデータを使った、横国生のための乗換案内。",
    path: "/hamakokuex/",
    image: "/ogp-hamakokuex.png",
  },
  hamakokumap: {
    title: "はまこく Map｜横浜国大のシェアサイクル",
    description:
      "横浜国立大学構内とその周辺のシェアサイクルポートを地図で見られます。HELLO CYCLING とドコモ・バイクシェアの、いま借りられる台数を事業者ごとに表示します。",
    path: "/hamakokumap/",
    image: "/ogp-hamakokumap.png",
  },
  // 免責事項・クレジットは site/disclaimer.html（/disclaimer）に移した。
  // 静的なページなので、OGP はそのページに直に書いてある
};

/**
 * @abstract EJS に渡す OGP の値を組み立てる
 * @param {keyof typeof SITE_META} key
 * @returns {{title:string, description:string, url:string, image:string}}
 */
export function pageMeta(key) {
  const meta = SITE_META[key] ?? SITE_META.hamakokuex;

  return {
    title: meta.title,
    description: meta.description,
    url: absoluteUrl(meta.path),
    image: absoluteUrl(meta.image),
  };
}
