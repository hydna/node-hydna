const spawn = require("parall/worker").spawn



spawn("./worker_reader", 25);
spawn("./worker_writer", 25);