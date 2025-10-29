const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
const PORT = 3000;
const SECRET_KEY = "tu_clave_secreta_aqui"; // ¡Cambia esto en producción!

// === BASES DE DATOS ===

const dbUsuarios = new sqlite3.Database('./usuarios.db', (err) => {
  if (err) console.error("Error BD usuarios:", err.message);
  else console.log("Conectado a usuarios.db");
});

const dbProductos = new sqlite3.Database('./product.db', (err) => {
  if (err) console.error("Error BD productos:", err.message);
  else console.log("Conectado a product.db");
});

// NUEVA CONEXIÓN PARA ÓRDENES/TRANSACCIONES
const dbOrdenes = new sqlite3.Database('./ordenes.db', (err) => {
  if (err) console.error("Error BD órdenes:", err.message);
  else console.log("Conectado a ordenes.db");
});

// Crear tabla usuarios
dbUsuarios.run(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    telefono TEXT NOT NULL,
    nombre TEXT NOT NULL,
    contraseña TEXT NOT NULL,
    rol_comprador INTEGER DEFAULT 1,
    rol_vendedor INTEGER DEFAULT 1
  )
`);

// Crear tabla productos (ACTUALIZADA con sellerId y stock)
dbProductos.run(`
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price TEXT NOT NULL,
    rating REAL NOT NULL,
    description TEXT NOT NULL,
    imageUrl TEXT NOT NULL,
    sellerId INTEGER NOT NULL,
    stock INTEGER NOT NULL,
    FOREIGN KEY(sellerId) REFERENCES usuarios(id) ON DELETE CASCADE
  )
`);

// Crear tabla órdenes (NUEVA: Historial de transacciones)
dbOrdenes.run(`
  CREATE TABLE IF NOT EXISTS ordenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    buyerId INTEGER NOT NULL,
    sellerId INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    totalPrice REAL NOT NULL,
    orderDate TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(productId) REFERENCES productos(id) ON DELETE RESTRICT,
    FOREIGN KEY(buyerId) REFERENCES usuarios(id) ON DELETE RESTRICT,
    FOREIGN KEY(sellerId) REFERENCES usuarios(id) ON DELETE RESTRICT
  )
`);


// === MIDDLEWARES ===
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001"],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// === MIDDLEWARE DE AUTENTICACIÓN ===
const verificarToken = (req, res, next) => {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Acceso denegado. Token requerido." });

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Token inválido o expirado." });
    req.user = decoded; // Ahora incluye: { id, email, nombre, ... }
    next();
  });
};

// Utilidad para convertir callbacks de SQLite a Promesas (necesario para la ruta /buy)
const dbGet = (db, sql, params) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
    });
});
const dbRun = (db, sql, params) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
        if (err) return reject(err);
        resolve(this);
    });
});


// === RUTAS DE AUTENTICACIÓN ===

// Registro
app.post("/register", (req, res) => {
  const { email, telefono, nombre, contraseña } = req.body;
  if (!email || !telefono || !nombre || !contraseña) {
    return res.status(400).json({ error: "Todos los campos son obligatorios." });
  }

  dbUsuarios.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, row) => {
    if (err) return res.status(500).json({ error: "Error en la base de datos." });
    if (row) return res.status(409).json({ error: "El correo ya está registrado." });

    dbUsuarios.run(
      "INSERT INTO usuarios (email, telefono, nombre, contraseña, rol_comprador, rol_vendedor) VALUES (?, ?, ?, ?, 1, 1)",
      [email, telefono, nombre, contraseña],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al registrar usuario." });

        res.json({
          mensaje: `¡Registro exitoso, ${nombre}!`,
          usuario: { email, telefono, nombre, rol_comprador: true, rol_vendedor: true }
        });
      }
    );
  });
});

// Login
app.post("/login", (req, res) => {
  const { email, contraseña } = req.body;
  if (!email || !contraseña) {
    return res.status(400).json({ error: "Email y contraseña requeridos." });
  }

  dbUsuarios.get(
    "SELECT * FROM usuarios WHERE email = ? AND contraseña = ?",
    [email, contraseña],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Error en el servidor." });
      if (!row) return res.status(401).json({ error: "Credenciales incorrectas." });

      const payload = {
        id: row.id, // ¡Importante! ID añadido al token
        email: row.email,
        nombre: row.nombre,
        rol_comprador: row.rol_comprador === 1,
        rol_vendedor: row.rol_vendedor === 1
      };

      const token = jwt.sign(payload, SECRET_KEY, { expiresIn: "1h" });
      res.cookie("token", token, { httpOnly: true, secure: false, maxAge: 3600000 }); // secure: true en HTTPS
      res.json({
        mensaje: "Login exitoso",
        token,
        usuario: {
          id: row.id,
          email: row.email,
          nombre: row.nombre,
          telefono: row.telefono,
          rol_comprador: row.rol_comprador === 1,
          rol_vendedor: row.rol_vendedor === 1
        }
      });
    }
  );
});

// Lista de usuarios (protegido opcionalmente)
app.get("/usuarios", verificarToken, (req, res) => {
  dbUsuarios.all("SELECT id, email, telefono, nombre, rol_comprador, rol_vendedor FROM usuarios", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error al obtener usuarios." });

    const usuarios = rows.map(r => ({
      ...r,
      rol_comprador: r.rol_comprador === 1,
      rol_vendedor: r.rol_vendedor === 1
    }));
    res.json({ usuarios });
  });
});


// === RUTAS DE PRODUCTOS ===

// Crear producto (requiere autenticación y rol de vendedor)
app.post("/createproduct", verificarToken, (req, res) => {
  if (!req.user.rol_vendedor) {
    return res.status(403).json({ error: "No tienes permiso para crear productos." });
  }

  const { name, price, rating, description, imageUrl, stock } = req.body;
  const sellerId = req.user.id; // Obtenido del token

  if (!name || !price || !rating || !description || !imageUrl || stock === undefined) {
    return res.status(400).json({ error: "Todos los campos (incluyendo stock) son requeridos." });
  }

  dbProductos.run(
    `INSERT INTO productos (name, price, rating, description, imageUrl, sellerId, stock)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, price, rating, JSON.stringify(description), imageUrl, sellerId, stock],
    function (err) {
      if (err) {
        console.error("Error al crear producto:", err.message);
        return res.status(500).json({ error: "Error al crear el producto.", details: err.message });
      }

      res.json({
        mensaje: "Producto creado exitosamente.",
        producto: { id: this.lastID, name, price, rating, description, imageUrl, sellerId, stock }
      });
    }
  );
});

// Listar todos los productos
app.get("/product", (req, res) => {
  dbProductos.all("SELECT * FROM productos", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error al obtener productos." });

    const productos = rows.map(p => ({
      ...p,
      description: JSON.parse(p.description)
    }));
    res.json({ productos });
  });
});

// Obtener un producto por ID
app.get("/product/:id", (req, res) => {
  const { id } = req.params;
  dbProductos.get("SELECT * FROM productos WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: "Error al buscar producto." });
    if (!row) return res.status(404).json({ error: "Producto no encontrado." });

    res.json({
      producto: {
        ...row,
        description: JSON.parse(row.description)
      }
    });
  });
});


// === RUTAS DE ÓRDENES Y TRANSACCIONES ===

// RUTA PARA REALIZAR UNA COMPRA
app.post("/buy", verificarToken, async (req, res) => {
  const { productId, quantity } = req.body;
  const buyerId = req.user.id; // El comprador es el usuario logueado

  if (!productId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: "ID de producto y cantidad válidos son requeridos." });
  }

  try {
    // 1. OBTENER INFORMACIÓN DEL PRODUCTO
    const productInfo = await dbGet(dbProductos, "SELECT * FROM productos WHERE id = ?", [productId]);

    if (!productInfo) {
      return res.status(404).json({ error: "Producto no encontrado." });
    }

    // Verificar si el comprador no es el vendedor
    if (productInfo.sellerId === buyerId) {
      return res.status(400).json({ error: "No puedes comprar tus propios productos." });
    }
    
    // 2. VERIFICAR STOCK
    const currentStock = productInfo.stock;
    if (currentStock < quantity) {
      return res.status(400).json({ 
        error: `Stock insuficiente. Solo quedan ${currentStock} unidades.`,
        availableStock: currentStock
      });
    }

    // 3. CALCULAR PRECIO FINAL
    const pricePerUnit = parseFloat(productInfo.price);
    const totalPrice = pricePerUnit * quantity;

    // 4. ACTUALIZAR STOCK
    const newStock = currentStock - quantity;
    await dbRun(
      dbProductos,
      "UPDATE productos SET stock = ? WHERE id = ?", 
      [newStock, productId]
    );

    // 5. REGISTRAR ORDEN
    const orderResult = await dbRun(
      dbOrdenes,
      `INSERT INTO ordenes (productId, buyerId, sellerId, quantity, totalPrice)
       VALUES (?, ?, ?, ?, ?)`,
      [productId, buyerId, productInfo.sellerId, quantity, totalPrice]
    );

    res.json({
      mensaje: "Compra realizada con éxito.",
      orden: { 
        id: orderResult.lastID, 
        productId, 
        buyerId, 
        sellerId: productInfo.sellerId, 
        quantity, 
        totalPrice 
      },
      nuevoStock: newStock
    });

  } catch (error) {
    console.error("Error en la transacción de compra:", error);
    res.status(500).json({ error: "Error al procesar la compra." });
  }
});


// RUTA DE HISTORIAL DE COMPRAS (El usuario es el BUYER)
app.get("/history/purchases", verificarToken, (req, res) => {
  const buyerId = req.user.id;

  dbOrdenes.all("SELECT * FROM ordenes WHERE buyerId = ? ORDER BY orderDate DESC", [buyerId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error al obtener el historial de compras." });
    res.json({ purchases: rows });
  });
});

// RUTA DE HISTORIAL DE VENTAS (El usuario es el SELLER)
app.get("/history/sales", verificarToken, (req, res) => {
  const sellerId = req.user.id;

  dbOrdenes.all("SELECT * FROM ordenes WHERE sellerId = ? ORDER BY orderDate DESC", [sellerId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error al obtener el historial de ventas." });
    res.json({ sales: rows });
  });
});


// === INICIAR SERVIDOR ===
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});