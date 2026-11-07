(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CAKE_PRODUCTS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  return [
    {
      id: "red-velvet-slice",
      name: "Red Velvet Slice",
      category: "Cake",
      price: 38000,
      image: "assets/images/red-velvet.jpg",
      description: "Slab red velvet lembut dengan cream cheese frosting yang gurih.",
      detail:
        "Red velvet dengan warna merah lembut dan tekstur spons yang moist, dilapisi cream cheese frosting buatan sendiri. Manisnya seimbang dengan sedikit rasa gurih di setiap gigitan."
    },
    {
      id: "tiramisu-cake",
      name: "Tiramisu Cake",
      category: "Cake",
      price: 45000,
      image: "assets/images/tiramisu.jpg",
      description: "Tiramisu klasik dengan mascarpone, biskuit, dan taburan kakao.",
      detail:
        "Lapisan biskuit lembut, krim mascarpone, dan rendaman kakao yang ringan. Didiamkan semalaman agar rasanya menyatu, lalu ditaburi kakao sebelum disajikan."
    },
    {
      id: "new-york-cheesecake",
      name: "New York Cheesecake",
      category: "Cake",
      price: 42000,
      image: "assets/images/cheesecake.jpg",
      description: "Cheesecake panggang creamy dengan dasar biskuit renyah.",
      detail:
        "Cheesecake gaya New York dengan tekstur padat dan creamy, dipanggang perlahan di atas dasar biskuit mentega. Disajikan dingin dengan sentuhan krim asam."
    },
    {
      id: "strawberry-shortcake",
      name: "Strawberry Shortcake",
      category: "Cake",
      price: 40000,
      image: "assets/images/strawberry-shortcake.jpg",
      description: "Spons lembut, krim vanila, dan stroberi segar berlapis.",
      detail:
        "Kue spons vanila yang ringan dipadukan whipped cream lembut dan stroberi segar berlapis. Pilihan favorit untuk perayaan kecil atau teman minum teh sore."
    },
    {
      id: "chocolate-lava-cake",
      name: "Chocolate Lava Cake",
      category: "Cake",
      price: 43000,
      image: "assets/images/lava-cake.jpg",
      description: "Kue cokelat hangat dengan lelehan cokelat di tengahnya.",
      detail:
        "Chocolate lava cake dengan bagian luar yang set dan bagian tengah yang meleleh hangat. Menggunakan cokelat dark premium dan disajikan segera setelah dipanggang."
    },
    {
      id: "vanilla-cupcake",
      name: "Vanilla Cupcake",
      category: "Cupcake",
      price: 22000,
      image: "assets/images/vanilla-cupcake.jpg",
      description: "Cupcake vanila lembut dengan buttercream manis dan taburan.",
      detail:
        "Cupcake vanila panggang dengan remah lembut, diberi buttercream vanila yang fluffy, lalu dihias taburan manis. Ukurannya pas untuk camilan satu orang."
    },
    {
      id: "macaron-box",
      name: "Macaron Box",
      category: "Cookies",
      price: 65000,
      image: "assets/images/macaron.jpg",
      description: "Enam macaron renyah dengan isian krim rasa buah dan cokelat.",
      detail:
        "Satu kotak berisi enam macaron dengan warna pastel, kulit renyah di luar dan chewy di dalam. Racikan rasa bergantian antara buah, vanila, dan cokelat."
    },
    {
      id: "butter-croissant",
      name: "Butter Croissant",
      category: "Pastry",
      price: 24000,
      image: "assets/images/croissant.jpg",
      description: "Croissant berlapis mentega, renyah di luar dan lembut di dalam.",
      detail:
        "Adonan berlapis dilipat perlahan dan dipanggang hingga keemasan. Aroma mentega yang hangat, kulit renyah, dan bagian dalam yang berongga lembut."
    },
    {
      id: "cookies-choco-chip",
      name: "Cookies Choco Chip",
      category: "Cookies",
      price: 28000,
      image: "assets/images/choco-chip-cookies.jpg",
      description: "Cookies lumer dengan cokelat chip dan sedikit garam laut.",
      detail:
        "Cookies dengan tepung mentega, cokelat chip besar, dan sejumput garam laut. Bagian tengahnya lembut dan sedikit chewy, pinggirannya renyah."
    },
    {
      id: "susu-cokelat-hangat",
      name: "Susu Cokelat Hangat",
      category: "Minuman",
      price: 25000,
      image: "assets/images/hot-chocolate.jpg",
      description: "Susu cokelat hangat dengan marshmallow empuk.",
      detail:
        "Susu segar dipanaskan dengan cokelat premium hingga lembut dan creamy, lalu ditaburi marshmallow empuk. Cocok menemani sepotong kue di sore hari."
    }
  ];
});
